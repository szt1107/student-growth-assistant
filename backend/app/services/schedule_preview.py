"""Partial planning drafts on AssistantProposal; original engine and confirmation.

An internal solver bound is only a completion window, never a fabricated Task
deadline. Partial drafts cannot enter the original confirmation transaction.
"""
from types import SimpleNamespace
from datetime import datetime, time, timedelta
from sqlalchemy import select
from ..models import AssistantProposal, AssistantSession, AssistantMessage, AssistantRun, Task
from ..workspace_schemas import SchedulePreview
from . import assistant_clock
from .assistant_scheduler import dt
from .assistant_state import build_proposal, preference_settings
from .planning_state import planning_transaction
from .workspace_views import revision
from .conversations import error
from . import draft_defaults
from .grid import valid_task_interval


def record_guard(db,row):
    from .scoped_replanning import guard_content
    markers=db.scalars(select(AssistantMessage).where(AssistantMessage.proposal_id==row.id,AssistantMessage.role=='assistant')).all()
    guarded=[m for m in markers if (m.content or {}).get('replanning_guard')]
    if guarded:
        for message in guarded:message.content=guard_content(row.payload)
    else:db.add(AssistantMessage(session_id=row.session_id,role='assistant',text=row.payload['summary'],proposal_id=row.id,content=guard_content(row.payload)))


def editable_schedule(db, row):
    """Recover legacy clock intent without rewriting the stored draft on reads."""
    value = dict(row.payload['preview_input'])
    policy = row.payload.get('start_policy_version', 0)
    if policy >= 6 or row.status in ('applied', 'discarded'):
        return value
    if policy >= 4 and row.payload.get('edit_receipt'):
        return value
    key = row.payload.get('preview_edit_receipt', {}).get('key') or row.payload.get('preview_key', '')
    parts = key.split(':')
    run = db.get(AssistantRun, int(parts[1])) if len(parts) == 3 and parts[0] == 'tool' and parts[1].isdigit() else None
    if run:
        messages = db.scalars(select(AssistantMessage.text).where(AssistantMessage.session_id == run.session_id,
            AssistantMessage.role == 'user', AssistantMessage.id <= run.payload['user_message_id'])
            .order_by(AssistantMessage.id.desc()).limit(12)).all()
        for text in messages:
            reference_day = datetime.fromisoformat(str(value['day'])).date()
            historical_now = run.created_at.astimezone(assistant_clock.SHANGHAI)
            parsed = draft_defaults.user_values(text, historical_now, reference_day=reference_day)
            if policy == 5:
                origins=row.payload.get('field_sources',{})
                if parsed.get('time_period') and 'start_exact' not in parsed:
                    value['start_exact']=False;value['time_period']=parsed['time_period']
                elif origins.get('start_exact')=='ai_interpretation' and 'start_exact' not in parsed:
                    value['start_exact']=False
                if parsed.get('title') and origins.get('title')=='user_explicit':value['title']=parsed['title']
                break
            if policy == 4:
                for field in ('title', 'duration_minutes', 'deadline', 'start_time', 'start_exact', 'time_period'):
                    if field in parsed:
                        value[field] = parsed[field]
            if policy < 4:
                origins = row.payload.get('field_sources', {})
                for field in ('title', 'duration_minutes'):
                    if field in parsed and origins.get(field) in (None, 'system_default', 'unresolved', 'schedule_adjusted'):
                        value[field] = parsed[field]
                if 'start_time' in parsed and origins.get('start_time') in (None, 'system_default', 'schedule_adjusted'):
                    value.update({field: parsed[field] for field in ('start_time', 'start_exact', 'time_period') if field in parsed})
            if policy < 2 and ('start_exact' in parsed or 'time_period' in parsed):
                value['start_exact'] = parsed.get('start_exact', False)
            if parsed.get('time_period') and 'time_period' not in value:
                period = parsed['time_period']
                begin, end, _ = draft_defaults.TIME_PERIODS[period]
                automatic = row.payload.get('field_sources', {}).get('start_time') in (
                    'system_default', 'confirmed_preference', 'schedule_adjusted')
                if begin <= value['start_time'] < end or automatic:
                    value['time_period'] = period
                    if automatic and not begin <= value['start_time'] < end:
                        value['start_time'] = parsed['start_time']
                break
            if 'start_time' in parsed:
                break
    return value


def dated_rows(row):
    """Project dated action drafts into the existing conflict explanation input."""
    payload = row.payload
    for action in payload.get('actions',[]):
        task=next((t for t in payload.get('tasks',[]) if t['ref']==action.get('target')),None)
        if not task or not task.get('title') or not task.get('deadline'):continue
        minutes=task.get('duration_minutes')
        if not minutes or minutes%5 or not 5<=minutes<=1440:continue
        profile=task.get('profile') or {}
        windows=profile.get('allowed_windows') or []
        pinned=bool(len(windows)>1 and profile.get('segment_count')==len(windows) and
            profile.get('fixed_start') and dt(profile['fixed_start'])==dt(windows[0]['start_at']))
        if len(windows)!=1 and not pinned:continue
        begin=dt(windows[0]['start_at']);end=dt(windows[-1]['end_at'])
        if end<=begin:continue
        preferred=profile.get('preferred_windows') or windows
        start=dt(profile['fixed_start']) if profile.get('fixed_start') else dt(preferred[0]['start_at'])
        value=dict(title=task['title'],duration_minutes=task['duration_minutes'],deadline=task['deadline'],
            day=begin.date().isoformat(),start_time=start.strftime('%H:%M'),
            task_id=task.get('id'),start_exact=bool(profile.get('fixed_start')))
        for period in draft_defaults.TIME_PERIODS:
            lower,upper=draft_defaults.day_window(begin.date(),period)
            if lower<=begin<end<=upper:
                value['time_period']=period
                break
        if pinned:value.update(segments=len(windows),work_segments=windows,break_minutes=profile.get('min_break_minutes',0))
        yield SimpleNamespace(payload={**payload,'preview_input':value,'actions':[action]},source_revision=row.source_revision)


def adjustments(db, row, status):
    if row.payload.get('preview_input') or status!='ready':
        return row.payload.get('schedule_adjustments',[])
    result=[]
    for scoped in dated_rows(row):
        target=scoped.payload['actions'][0]['target']
        items=sorted((item for item in row.payload['items'] if item['ref']==target),key=lambda item:item['start_at'])
        if not items:continue
        start=dt(items[0]['start_at']);end=dt(items[-1]['end_at'])
        if start.strftime('%H:%M')==scoped.payload['preview_input']['start_time']:continue
        blockers=[problem['message'] for problem in problems(db,scoped,'conflict') if problem['code']=='TIME_OCCUPIED']
        if blockers:result.append(' '.join(blockers)+f' 已避开占用，草案安排为{start:%H:%M}–{end:%H:%M}。')
    return result


def problems(db, row, status):
    """Explain blocked drafts using current, read-only calendar facts."""
    if status not in ('needs_input', 'conflict', 'no_plan'):
        return []
    payload = row.payload
    value = payload.get('preview_input')
    if not value:
        result=[problem for scoped in dated_rows(row) for problem in problems(db,scoped,status)]
        if result:return result
        return [dict(code=d['code'], message=d['message'], suggestion='请调整对应任务的时间要求，再重新生成方案。')
            for d in payload.get('diagnostics', []) if d.get('code') in
            ('FIXED_TASK_CONFLICT', 'FIXED_TIME_CONFLICT', 'NO_CONTINUOUS_SLOT', 'NO_PLAN_FOUND', 'SEARCH_LIMIT')]
    value = SchedulePreview.model_validate(value)
    if row.source_revision != revision(db):
        return [dict(code='SOURCE_CHANGED', message='日程或任务在这份草案生成后有了变化。',
            suggestion='请让 AI 按最新日程重新生成草案，再确认采用。')]
    if payload.get('calendar_record'):
        return payload.get('calendar_problems', [])
    result = []
    if value.title == '待命名任务':
        result.append(dict(code='TITLE_REQUIRED', message='这项任务还没有名称。', suggestion='请填写“名称”，再保存草案。'))
    if not value.deadline and not value.task_id:
        result.append(dict(code='DEADLINE_REQUIRED', message='还没有填写最晚完成时间。',
            suggestion='请填写“截止时间”；有候选安排时，也可以选择“以安排结束时间作为截止”。'))
    if status == 'needs_input':
        return result
    now = assistant_clock.assistant_now()
    start = datetime.combine(value.day, time.fromisoformat(value.start_time), assistant_clock.SHANGHAI)
    if value.start_exact and start<now:
        result.append(dict(code='START_IN_PAST',message=f'你指定的{start:%m月%d日 %H:%M}开始时间已经过去。',
            suggestion='请明确选择新的开始时间，再保存草案重新计算。'))
        return result
    _, end = draft_defaults.day_window(value.day, value.time_period)
    if value.start_exact and not value.time_period:
        end=max(end,start+timedelta(minutes=value.duration_minutes+value.break_minutes*(value.segments-1)))
    deadline = value.deadline or end
    if value.task_id and not value.deadline:
        task = db.get(Task, value.task_id)
        if task:deadline = task.deadline
    deadline=dt(deadline)
    if deadline.date()<value.day:
        result.append(dict(code='DATE_AFTER_DEADLINE',
            message=f'你希望{value.day.month}月{value.day.day}日安排“{value.title}”，但它目前的截止时间是{deadline.month}月{deadline.day}日{deadline:%H:%M}。',
            suggestion='如果要调整原任务，请先确认并修改“截止时间”；如果这是另一次活动，请说明新建任务。'))
        return result
    end = min(end, deadline)
    earliest = max(start, now, datetime.combine(value.day, time.min, assistant_clock.SHANGHAI))
    earliest += timedelta(seconds=(-earliest.timestamp()) % 300)
    rest = value.break_minutes * (value.segments - 1)
    required = value.duration_minutes + rest
    duration = timedelta(minutes=required)
    if earliest + duration > end and not value.work_segments:
        available = max(0, int((end - earliest).total_seconds() // 60))
        result.append(dict(code='INSUFFICIENT_TIME',
            message=f'当前开始时间到最晚可安排时间只有{available}分钟；工作需要{value.duration_minutes}分钟，段间休息需要{rest}分钟。',
            suggestion='请提前“建议开始时间”、延后“截止时间”或改选日期；也可以按实际需要减少工作时长或段间休息。'))
        return result
    from .workspace_views import calendar_events
    last_day=dt(value.work_segments[-1].end_at).date() if value.work_segments else min(end,earliest+duration).date()
    calendar = calendar_events(db, value.day, last_day + timedelta(days=1))
    occupied = []
    for event in calendar['events']:
        if event.get('blocks_time') is False or event['kind'] in ('deadline', 'goal'):
            continue
        if value.task_id and event.get('task_id') == value.task_id:
            continue
        begin = event.get('busy_start') or event['start']
        finish = event.get('busy_end') or event.get('end')
        if finish:
            occupied.append((dt(begin), dt(finish), event['title']))
    cursor = earliest
    free = []
    for begin, finish, _ in sorted(occupied):
        if begin >= end or finish <= cursor:continue
        if begin > cursor:free.append((cursor, min(begin, end)))
        cursor = max(cursor, finish)
    if cursor < end:free.append((cursor, end))
    target=payload['actions'][0]['target'] if payload.get('actions') else None
    assigned=[item for item in payload.get('items',[]) if item['ref']==target]
    task=next((task for task in payload.get('tasks',[]) if task['ref']==target),{})
    if value.segments>1 and not assigned:
        if (task.get('profile') or {}).get('locked'):
            return result+[dict(code='LOCKED_SEGMENT',message=f'“{value.title}”已锁定，不能更改原有分段。',
                suggestion='需要重新分配时，请先到任务详情解除锁定。')]
        if value.work_segments:
            for index,window in enumerate(value.work_segments,1):
                begin_at=dt(window.start_at);end_at=dt(window.end_at)
                if not valid_task_interval(begin_at,end_at):
                    result.append(dict(code='INVALID_SEGMENT_TIME',message=f'第{index}段不符合全天24小时的5分钟安排网格（单段最多24小时）。',
                        suggestion='请调整这一段的起止时间后保存。'))
                if window.end_at>deadline:
                    result.append(dict(code='DEADLINE_VIOLATION',message=f'第{index}段结束时间晚于{deadline:%m月%d日 %H:%M}的截止时间。',
                        suggestion='请提前这一段，或确认新的真实截止时间。'))
                for begin,finish,title in occupied:
                    if begin<window.end_at and window.start_at<finish:
                        result.append(dict(code='TIME_OCCUPIED',message=f'第{index}段与“{title}”（{begin:%m月%d日 %H:%M}–{finish:%H:%M}）重叠。',
                            suggestion='请修改这一段的起止时间，或点击“分段”重新分配。'))
            if result:return result
        if not value.start_exact:
            available=sum(int((finish-begin).total_seconds()/60) for begin,finish in free)
            message=(f'当前起点之后至截止前共有{available}分钟空档，任务需要{value.duration_minutes}分钟。'
                if available<value.duration_minutes else f'当前空档未能按{value.segments}段组合出{value.duration_minutes}分钟的完整安排。')
            return result+[dict(code='NO_SPLIT_PLAN',message=message,
                suggestion='请调整分段数量或开始日期后重新分段，也可以手动填写各段时间。')]
    alternative = next((a + timedelta(seconds=(-a.timestamp()) % 300) for a, b in free
        if a + timedelta(seconds=(-a.timestamp()) % 300) + duration <= b), None)
    suggestion = (f'可以尝试将“建议开始时间”改为{alternative:%H:%M}，预计{alternative + duration:%H:%M}完成；点击“保存草案编辑”重新检查。'
        if alternative else '当天在截止前没有能放下当前工作与休息的完整空档。请改选日期、延后截止时间，或按实际需要调整工作时长。')
    if not alternative and value.time_period:
        begin_clock,end_clock,label=draft_defaults.TIME_PERIODS[value.time_period]
        suggestion=f'{value.day:%m月%d日}{label}（{begin_clock}–{end_clock}）内没有足够的完整空档。可以减少时长、允许分段，或明确改到其他时段后重新计算。'
    if (task.get('profile') or {}).get('locked'):
        suggestion = '该任务已锁定，请到任务详情核对原安排；需要改时间时，先由你解除锁定。'
    collisions = [(a, b, title) for a, b, title in occupied if a < earliest + duration and earliest < b]
    if collisions:
        for begin, finish, title in list(dict.fromkeys(collisions))[:3]:
            result.append(dict(code='TIME_OCCUPIED',
                message=f'{value.day.month}月{value.day.day}日{earliest:%H:%M}开始的“{value.title}”与“{title}”（{begin:%H:%M}–{finish:%H:%M}）重叠。',
                suggestion=suggestion))
    else:
        budget_hit = any(d.get('code') == 'SEARCH_LIMIT' for d in payload.get('diagnostics', []))
        result.append(dict(code='SEARCH_LIMIT' if budget_hit else 'NO_SLOT',
            message='这次计算在限定时间内还没有找到完整方案。' if budget_hit else f'“{value.title}”按当前日期、时长和分段设置还没有找到可用安排。',
            suggestion='请稍后重新生成方案，或缩小本次需要调整的任务范围。' if budget_hit else suggestion))
    return result


def calculate(db, session, value, sources, target):
    now=assistant_clock.assistant_now();week=session.week_start
    start=datetime.combine(value.day,time.fromisoformat(value.start_time),assistant_clock.SHANGHAI)
    calendar_record = value.start_exact and start < now and not value.task_id
    if not calendar_record and not week<=value.day<week+timedelta(days=14):
        error('OUTSIDE_PLANNING_WINDOW','初稿日期须在本周与下周；不会自动改到其他日期。',422)
    period_start,end=draft_defaults.day_window(value.day,value.time_period)
    if value.time_period and any(window.start_at<period_start or window.end_at>end for window in value.work_segments):
        error('INVALID_DRAFT','分段时间超出所选日期或时段，请先明确修改时段要求。',422)
    # Explicit clocks stay fixed; only flexible suggestions may move.
    # A fixed late-night occasion may finish after midnight.
    if value.start_exact and not value.time_period:
        end=max(end,start+timedelta(minutes=value.duration_minutes+value.break_minutes*(value.segments-1)))
    earliest=max(start,now)
    earliest=earliest.replace(second=0,microsecond=0)+timedelta(minutes=bool(earliest.second or earliest.microsecond))
    earliest+=timedelta(minutes=(-earliest.minute)%5)
    window_start=max(period_start,min(start,end-timedelta(minutes=5)))
    allowed_start=window_start if value.start_exact else period_start
    fields={'title':value.title,'duration_minutes':value.duration_minutes,'priority':value.priority,
        'deadline':(value.deadline or end).isoformat(),
        'profile':{'allowed_windows':[{'start_at':allowed_start.isoformat(),'end_at':end.isoformat()}],
            'preferred_windows':[{'start_at':window_start.isoformat(),'end_at':end.isoformat()}],
            'fixed_start':start.isoformat() if value.start_exact else None,
            'splittable':value.segments>1,'max_segments':value.segments,'segment_count':value.segments,
            'min_block_minutes':value.min_block_minutes,'min_break_minutes':value.break_minutes}}
    if value.task_id:
        task=db.get(Task,value.task_id)
        if not task or task.task_kind!='executable':error('TASK_NOT_FOUND','原任务已不存在或不是可执行任务。',404)
        # Existing real deadlines remain authoritative unless explicitly edited.
        fields['deadline']=(value.deadline or task.deadline).isoformat()
    action={'op':'update' if value.task_id else 'add','target':target,'fields':fields}
    prefs=preference_settings(db)['settings']
    if value.work_segments:
        fields['profile']['allowed_windows']=[window.model_dump(mode='json') for window in value.work_segments]
        fields['profile']['fixed_start']=value.work_segments[0].start_at.isoformat()
        if not value.deadline and not value.task_id:
            fields['deadline']=max(end,value.work_segments[-1].end_at).isoformat()
    payload=build_proposal(db,week,[action],preferences=prefs,include_unplanned=False)
    payload['preview_input']=value.model_dump(mode='json')
    payload['start_policy_version']=6
    payload['field_sources']=dict(sources)
    payload['schedule_adjustments']=[]
    if calendar_record:
        from .calendar_drafts import prepare_record
        return prepare_record(db, payload, value, target)
    assigned=sorted((x for x in payload['items'] if x['ref']==target),key=lambda x:x['start_at'])
    if assigned and value.segments>1:
        payload['preview_input']['work_segments']=[{'start_at':item['start_at'],'end_at':item['end_at']} for item in assigned]
    if assigned and not value.start_exact:
        chosen=dt(assigned[0]['start_at'])
        if chosen!=start:
            explanation=problems(db,SimpleNamespace(payload=payload,source_revision=revision(db)),'conflict')
            blockers=[p['message'] for p in explanation if p['code']=='TIME_OCCUPIED']
            finish=dt(assigned[-1]['end_at'])
            reason=' '.join(blockers) if blockers else f'已结合当天的可用时段调整了“{value.title}”的开始时间。'
            payload['schedule_adjustments']=[reason+f' 草案已安排为{chosen:%H:%M}开始，预计{finish:%H:%M}完成，请查看后确认。']
            payload['preview_input']['start_time']=chosen.strftime('%H:%M')
            payload['field_sources']['start_time']='schedule_adjusted'
    payload['suggested_not_before']=earliest.isoformat()
    payload['unresolved']=[]
    if value.title=='待命名任务':payload['unresolved'].append('请填写并确认任务名称。')
    if not value.deadline and not value.task_id:
        payload['unresolved'].append('现有正式任务必须填写真实截止时间；当前仅按完成窗口预览，未设置硬截止。')
        # Remove the transient solver bound from every persisted business fact
        # field. It remains explicit only as window_end, never as a Task DDL.
        payload['actions'][0]['fields'].pop('deadline',None)
        for task in payload['tasks']:
            if task['ref']==target:task['deadline']=None
        for change in payload['changes']:
            if change['ref']==target:change['deadline']=None
        payload['candidate_options']=[];payload['alternatives']=[]
    if payload['status']=='ready' and payload['unresolved']:payload['status']='needs_input'
    if not any(x['ref']==target for x in payload['items']):
        payload['notices'].append('当前日期内还没有找到满足所选分段数的完整安排。' if value.segments>1 else
            '所选日期的剩余合法时段无法放下完整工作时长；可缩短、拆分或另选日期，未自动延到明天。')
    if earliest>start:payload['notices'].append('建议起点已过；只在当前时间之后的合法5分钟网格寻找安排。')
    payload['summary']=value.title+' · 可编辑初稿，尚未写入正式任务或日程。'
    payload['questions']=payload.get('questions',[])+payload['unresolved']
    return payload


def create(db, run, request, key, session_factory, *, base_ref=None, interpreted_fields=None):
    from . import workspace_drafts
    now=assistant_clock.assistant_now()
    run_token=run.payload.get('token')
    source_revision=revision(db)
    base=None;sources=None;row=None
    if base_ref:
        row=workspace_drafts.require(db,'planning',base_ref['id'])
        if row.payload.get('preview_edit_receipt')=={'key':key,'message':request['message']}:
            return workspace_drafts.envelope(db,'planning',row.id)
        workspace_drafts.check(db,row,base_ref['version'])
        if not draft_defaults.user_values(request['message'],now) and request['message'].startswith(('就用','按这个','就这样')):
            return workspace_drafts.envelope(db,'planning',row.id)
        session=db.get(AssistantSession,row.session_id)
        if session.latest_proposal_id!=row.id or row.status not in ('ready','needs_input','conflict','no_plan'):
            error('STALE_DRAFT','这份草案不可继续修改，请读取最新状态。')
        if row.source_revision!=revision(db):error('STALE_DRAFT','正式资料已变化，请保留输入并重新生成。')
        base=editable_schedule(db,row);sources=row.payload['field_sources']
    saved=preference_settings(db)
    value,origins=draft_defaults.schedule(request,now,base=base,sources=sources,
        preferences=None if saved['is_sample'] else saved['settings'], interpreted_fields=interpreted_fields)
    independent=not base and draft_defaults.independent_schedule(request['message'],now)
    matches=db.scalars(select(Task).where(Task.title==value.title,Task.task_kind=='executable')).all() if not value.task_id and not independent else []
    if len(matches)>1:error('AMBIGUOUS_TASK','存在多个同名正式任务，请先在工作区选择具体任务。',422)
    if matches:
        task=matches[0]
        if task.status.value!='todo':error('TASK_UNAVAILABLE','同名任务已完成或取消，请明确选择或修改名称。',422)
        updates={'task_id':task.id}
        for field,formal in [('deadline',task.deadline),('duration_minutes',task.duration_minutes),('priority',task.priority.value)]:
            if origins.get(field) in ('unresolved','system_default'):updates[field]=formal;origins[field]='formal_task'
        value=value.model_copy(update=updates);origins['task_id']='formal_task'
    target=row.payload['actions'][0]['target'] if row else f'task:{value.task_id}' if value.task_id else f'draft:preview-{run.id}'
    calculation_session=session if row else SimpleNamespace(week_start=now.date()-timedelta(days=now.weekday()))
    payload=calculate(db,calculation_session,value,origins,target)
    # Solve outside the writer lock; recheck the complete source revision and
    # optimistic draft version before persisting this calculated snapshot.
    db.rollback()
    with planning_transaction(db):
        live=db.get(AssistantRun,run.id,populate_existing=True)
        if live.status!='running' or live.payload.get('token')!=run_token:error('RUN_STOPPED','回复已停止，未保存新的初稿。')
        if revision(db)!=source_revision:error('STALE_DRAFT','读取期间正式资料已变化，请重新读取。')
        if base_ref:
            row=workspace_drafts.require(db,'planning',base_ref['id'])
            receipt={'key':key,'message':request['message']}
            if row.payload.get('preview_edit_receipt')==receipt:return workspace_drafts.envelope(db,'planning',row.id)
            workspace_drafts.check(db,row,base_ref['version'])
            if row.source_revision!=revision(db):error('STALE_DRAFT','正式资料已变化，请重新读取。')
            session=db.get(AssistantSession,row.session_id)
        else:
            session=session_factory(db,run.session_id,'planning')
            previous=db.scalar(select(AssistantProposal).where(AssistantProposal.session_id==session.id,AssistantProposal.payload['preview_key'].as_string()==key))
            if previous:return workspace_drafts.envelope(db,'planning',previous.id)
        payload['preview_key']=row.payload.get('preview_key',key) if row else key
        payload['preview_edit_receipt']={'key':key,'message':request['message']}
        if row:row.payload=payload;row.status=payload['status']
        else:
            row=AssistantProposal(session_id=session.id,source_revision=revision(db),status=payload['status'],payload=payload)
            db.add(row);db.flush();session.latest_proposal_id=row.id
        record_guard(db,row)
        return workspace_drafts.envelope(db,'planning',row.id)


def edit(db,id,expected,content):
    from . import workspace_drafts
    if set(content)!={'schedule'}:error('INVALID_DRAFT','初稿编辑只接受日程字段。',422)
    value=SchedulePreview.model_validate(content['schedule'])
    row=workspace_drafts.require(db,'planning',id)
    receipt={'from':expected,'content':content}
    if row.payload.get('edit_receipt')==receipt:return workspace_drafts.envelope(db,'planning',id)
    workspace_drafts.check(db,row,expected)
    session=db.get(AssistantSession,row.session_id)
    before=row.payload['preview_input']
    if value.task_id!=before.get('task_id'):error('INVALID_DRAFT','不能通过初稿编辑替换正式任务身份。',422)
    origins={**row.payload['field_sources'],**{k:'user_explicit' for k,v in value.model_dump(mode='json').items() if before.get(k)!=v}}
    prepared=calculate(db,session,value,origins,row.payload['actions'][0]['target'])
    db.rollback()
    with planning_transaction(db):
        row=workspace_drafts.require(db,'planning',id)
        receipt={'from':expected,'content':content}
        if row.payload.get('edit_receipt')==receipt:return workspace_drafts.envelope(db,'planning',id)
        workspace_drafts.check(db,row,expected)
        session=db.get(AssistantSession,row.session_id)
        if session.latest_proposal_id!=id or row.status not in ('ready','needs_input','conflict','no_plan') or row.source_revision!=revision(db):
            error('STALE_DRAFT','草案已失效，请保留输入并重新读取。')
        before=row.payload['preview_input']
        if value.task_id!=before.get('task_id'):error('INVALID_DRAFT','不能通过初稿编辑替换正式任务身份。',422)
        payload=prepared
        row.payload={**payload,'preview_key':row.payload['preview_key'],'edit_receipt':receipt};row.status=payload['status']
        record_guard(db,row)
        return workspace_drafts.envelope(db,'planning',id)
