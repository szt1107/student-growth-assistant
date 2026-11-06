"""Chat adapters over existing calendar, attention and execution services.

Reads do not mutate facts. Operations are validated at draft creation and again
inside the original confirmation transaction; this module never commits.
"""
from datetime import datetime, timedelta
from sqlalchemy import select
from ..models import TimeRule, Task, TaskWorkSession, TaskCategory, utc_now
from ..schemas import TimeRuleCreate, TimeRuleUpdate, TimeRuleResponse
from ..services.conversations import error

READ_TOOLS = frozenset({'attention', 'time_rules', 'task_execution'})
RULE_OPS = frozenset({'create_time_rule', 'update_time_rule'})


def validate_operation(db, scope, op):
    name = op.get('op')
    if name in RULE_OPS:
        if scope != 'profile':
            error('INVALID_DRAFT', '课程与保护时间须使用资料草案。', 422)
        if name == 'create_time_rule':
            return TimeRuleCreate.model_validate({k:v for k,v in op.items() if k!='op'})
        if set(op) != {'op', 'id', 'fields'} or type(op['id']) is not int or not isinstance(op['fields'], dict):
            error('INVALID_DRAFT', '时间规则修改格式无效。', 422)
        row = db.get(TimeRule, op['id'])
        if row is None:
            error('RULE_NOT_FOUND', '请先查询要修改的课程或保护时间。', 422)
        changes = TimeRuleUpdate.model_validate(op['fields']).model_dump(exclude_unset=True)
        return TimeRuleCreate.model_validate({**{k:getattr(row,k) for k in TimeRuleCreate.model_fields}, **changes})
    if name != 'work_timer':
        return None
    if scope != 'feedback' or set(op)-{'op','task_id','action','session_id','expected_updated_at'} or type(op.get('task_id')) is not int:
        error('INVALID_DRAFT', '计时操作格式无效。', 422)
    task = db.get(Task, op['task_id'])
    if not task or task.task_kind != 'executable':
        error('TASK_NOT_TODO', '计时须关联真实可执行任务。', 422)
    action = op.get('action')
    if action not in ('start','pause','resume','finish'):
        error('INVALID_DRAFT', '不支持的计时操作。', 422)
    if action in ('start','resume') and task.status.value != 'todo':
        error('TASK_NOT_TODO', '仅待完成任务可以开始或继续计时；已完成任务的旧计时仍可结束。', 422)
    if action == 'start':
        if op.get('session_id') is not None or op.get('expected_updated_at') is not None:
            error('INVALID_DRAFT', '新计时不能引用已有计时。', 422)
        if db.scalar(select(TaskWorkSession.id).where(
            (TaskWorkSession.status=='running') | ((TaskWorkSession.task_id==task.id) & (TaskWorkSession.status=='paused')))):
            error('TIMER_CONFLICT', '已有运行中计时或本任务的暂停计时，请先查看并处理。')
        return task
    if type(op.get('session_id')) is not int or not isinstance(op.get('expected_updated_at'), str):
        error('INVALID_DRAFT', '请先读取计时状态与版本。', 422)
    row = db.get(TaskWorkSession, op['session_id'])
    expected = datetime.fromisoformat(op['expected_updated_at'].replace('Z','+00:00'))
    if not row or row.task_id != task.id or row.updated_at != expected:
        error('TIMER_CHANGED', '计时状态已变化，请重新查询。')
    if action=='pause' and row.status!='running' or action=='resume' and row.status!='paused' or action=='finish' and row.status not in ('running','paused'):
        error('TIMER_CHANGED', '计时状态不支持本次操作，请重新查询。')
    if action=='resume' and db.scalar(select(TaskWorkSession.id).where(TaskWorkSession.status=='running')):
        error('TIMER_CONFLICT', '另一个任务正在计时。')
    return row


def apply_operation(db, scope, op, key):
    value = validate_operation(db, scope, op)
    if op['op']=='create_time_rule':
        row = TimeRule(**value.model_dump()); db.add(row); db.flush()
        return {'rule_id': row.id}
    if op['op']=='update_time_rule':
        row = db.get(TimeRule, op['id'])
        for field, item in value.model_dump().items():
            setattr(row, field, item)
        row.updated_at = max(utc_now(), row.updated_at+timedelta(microseconds=1))
        db.flush()
        return {'rule_id': row.id}
    from ..services.growth_tracking import ensure_task_context, pause_work_session, resume_work_session, stop_work_session
    if op['action']=='start':
        context = ensure_task_context(db, value)
        category = db.get(TaskCategory, context.family) if context.family else None
        row = TaskWorkSession(task_id=value.id, client_action_id=key, status='running',
            family_snapshot=context.family, category_name_snapshot=category.name if category else context.family or '未分类',
            family_confirmed_snapshot=context.family_confirmed, accumulated_seconds=0, segment_started_at=utc_now())
        db.add(row)
    else:
        row=value
        previous_updated_at=row.updated_at
        {'pause':pause_work_session, 'resume':resume_work_session, 'finish':stop_work_session}[op['action']](row)
        row.updated_at=max(row.updated_at,previous_updated_at+timedelta(microseconds=1))
    db.flush()
    return {'timer_id':row.id, 'timer_status':row.status}


def read(db, name, args):
    from ..secretary_schemas import LookupArgs
    if name=='attention':
        if args: error('INVALID_TOOL', '优先建议无需额外参数。', 422)
        from ..routers.growth_attention import attention_items
        return {**attention_items(db), 'source':'正式任务、截止、课程和保护时间计算结果；未修改安排'}
    if name=='time_rules':
        values = LookupArgs.model_validate(args)
        query = select(TimeRule)
        if values.id is not None: query=query.where(TimeRule.id==values.id)
        if values.q.strip(): query=query.where(TimeRule.title.contains(values.q.strip(),autoescape=True))
        rows=db.scalars(query.order_by(TimeRule.id).offset(values.offset).limit(values.limit+1)).all()
        return {'items':[TimeRuleResponse.model_validate(r).model_dump(mode='json') for r in rows[:values.limit]],
            'next_offset':values.offset+values.limit if len(rows)>values.limit else None, 'source':'正式课程与保护时间规则'}
    values=LookupArgs.model_validate(args)
    if values.id is None:
        from ..services.growth_tracking import session_payload
        rows=db.scalars(select(TaskWorkSession).where(TaskWorkSession.status.in_(['running','paused'])).order_by(TaskWorkSession.id.desc()).limit(values.limit)).all()
        return {'active_timers':[{**session_payload(row),'task_title':db.get(Task,row.task_id).title} for row in rows],
            'source':'真实活动计时；读取具体任务反馈时请指定id'}
    task=db.get(Task, values.id)
    if task is None: error('TASK_NOT_FOUND', '任务不存在。', 404)
    from ..services.growth_tracking import session_payload
    # The existing history endpoint also returns a context but can initialize it;
    # read feedback directly to keep this tool genuinely read-only.
    from ..models import TaskFeedback
    rows=db.scalars(select(TaskFeedback).where(TaskFeedback.task_id==task.id).order_by(TaskFeedback.id.desc()).offset(values.offset).limit(values.limit+1)).all()
    timer=db.scalar(select(TaskWorkSession).where(TaskWorkSession.task_id==task.id).order_by(TaskWorkSession.id.desc()).limit(1))
    return {'task':{'id':task.id,'title':task.title,'status':task.status.value,'remaining_minutes':task.duration_minutes},
        'feedback':{'entries':[{'id':r.id,'outcome':r.outcome,'actual_minutes':r.actual_minutes,
            'remaining_minutes':r.remaining_minutes,'reason':r.reason,'occurred_at':r.occurred_at,
            'retracted_at':r.retracted_at} for r in rows[:values.limit]], 'next_offset':values.offset+values.limit if len(rows)>values.limit else None},
        'timer':session_payload(timer) if timer else None, 'source':'正式任务、执行反馈和计时；计时不等于完成'}
