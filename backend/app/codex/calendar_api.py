"""Transactional calendar editing over existing schedules and local events."""
from datetime import date, datetime, time, timedelta
from hashlib import sha256
from typing import Literal
import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import CalendarEntry, CalendarMutation, Plan, PlanItem, Task, TimeRule, TaskSchedulingProfile, utc_now
from ..services.assistant_clock import SHANGHAI, assistant_now
from ..services.conversations import error
from ..services.planning_state import planning_transaction, get_or_create_planning_state, bump_revision
from ..services.scheduling_types import TimeRuleInput

router=APIRouter(prefix='/api/calendar',tags=['Calendar editing'])


class CalendarChange(BaseModel):
    model_config=ConfigDict(extra='forbid')
    action: Literal['save','delete']='save'
    event_id: str | None=Field(default=None,max_length=160)
    title: str=Field(default='',max_length=160)
    description: str=Field(default='',max_length=4000)
    start: str=''
    end: str=''
    all_day: bool=False
    blocks_time: bool=True
    expected_revision: int=Field(ge=0)
    client_request_id: str=Field(min_length=1,max_length=100)

    @model_validator(mode='after')
    def validate_interval(self):
        if self.action=='delete':
            if not self.event_id:raise ValueError('请选择要删除的事项')
            return self
        self.title=self.title.strip()
        if not self.title:raise ValueError('请填写事项名称')
        start,end=parse_interval(self.start,self.end,self.all_day)
        if not datetime(2000,1,1,tzinfo=SHANGHAI)<=start<end<=datetime(2101,1,1,tzinfo=SHANGHAI):
            raise ValueError('日期应在2000–2100年内，结束时间必须晚于开始时间')
        if end-start>timedelta(days=366):raise ValueError('单次事项最长366天')
        return self


def parse_interval(start,end,all_day):
    if all_day:
        return tuple(datetime.combine(date.fromisoformat(v),time.min,SHANGHAI) for v in (start,end))
    values=tuple(datetime.fromisoformat(v) for v in (start,end))
    if any(v.tzinfo is None or v.utcoffset() is None for v in values):raise ValueError('时间必须带时区')
    return tuple(v.astimezone(SHANGHAI) for v in values)


def projected_entries(db,a,b,entries=None):
    rows=db.scalars(select(CalendarEntry).where(CalendarEntry.deleted.is_(False),CalendarEntry.start_at<b,CalendarEntry.end_at>a).order_by(CalendarEntry.id).limit(6001)).all() if entries is None else [e for e in entries if not e.deleted and e.start_at<b and e.end_at>a]
    if len(rows)>6000:error('RANGE_TOO_LARGE','日历事项过多，请缩小范围。',413)
    return [dict(id=f'calendar:{e.id}',title=e.title,description=e.description,
        start=e.start_at.astimezone(SHANGHAI).date().isoformat() if e.all_day else e.start_at.isoformat(),
        end=e.end_at.astimezone(SHANGHAI).date().isoformat() if e.all_day else e.end_at.isoformat(),
        allDay=e.all_day,kind='calendar',blocks_time=e.blocks_time,
        busy_start=e.start_at.isoformat(),busy_end=e.end_at.isoformat(),source='单次调整' if e.source_key else '手动日程',
        source_rule_id=e.source_rule_id) for e in rows]


def calendar_rules(entries):
    """Expose local busy events to all consumers of the shared rule expander."""
    rules=[]
    for entry in entries:
        if entry.deleted or not entry.blocks_time:continue
        start=entry.start_at.astimezone(SHANGHAI);end=entry.end_at.astimezone(SHANGHAI)
        day=start.date();index=0
        while datetime.combine(day,time.min,SHANGHAI)<end:
            left=max(start,datetime.combine(day,time.min,SHANGHAI))
            right=min(end,datetime.combine(day,time.max,SHANGHAI))
            if right>left:
                rules.append(TimeRuleInput(id=1_000_000_000+entry.id*400+index,kind='protected',title=entry.title,
                    recurrence='once',date=day,start_time=left.time(),end_time=right.time()))
            day+=timedelta(days=1);index+=1
    return rules


def validate_calendar_backup(tables):
    """Reject corrupt calendar facts before a restore can delete current data."""
    for row in tables['calendar_entries']:
        a=row['start_at'].astimezone(SHANGHAI);b=row['end_at'].astimezone(SHANGHAI)
        if row['id']<1:raise ValueError('invalid calendar ID')
        if row['all_day'] and (a.time()!=time.min or b.time()!=time.min):raise ValueError('all-day boundary')
        CalendarChange(title=row['title'],description=row['description'],start=a.date().isoformat() if row['all_day'] else a.isoformat(),
            end=b.date().isoformat() if row['all_day'] else b.isoformat(),all_day=row['all_day'],blocks_time=row['blocks_time'],
            expected_revision=0,client_request_id='backup-validation')
        if row['source_key'] is None:
            if row['source_rule_id'] is not None or row['source_date'] is not None:raise ValueError('incomplete source')
        else:
            prefix,rid,stamp=row['source_key'].split(':',2)
            stamp=datetime.fromisoformat(stamp)
            if prefix!='rule' or int(rid)!=row['source_rule_id'] or stamp.tzinfo is None or stamp.astimezone(SHANGHAI).date()!=row['source_date']:
                raise ValueError('invalid occurrence source')
    for row in tables['calendar_mutations']:
        if not row['request_id'].strip() or len(row['request_id'])>100 or len(row['fingerprint'])!=64 or any(c not in '0123456789abcdef' for c in row['fingerprint']):raise ValueError('invalid request receipt')
        result=row['result']
        if not isinstance(result,dict) or result.get('action') not in ('save','delete') or type(result.get('revision')) is not int or result['revision']<0 or not isinstance(result.get('event_id'),str):raise ValueError('invalid receipt result')


def original_event(db,key):
    """Resolve IDs through actual records, never trust client metadata."""
    try:
        prefix,identity=key.split(':',1)
        if prefix=='calendar':
            item=db.get(CalendarEntry,int(identity))
            if not item or item.deleted:error('NOT_FOUND','该日程已移除。',404)
            return prefix,item,item.start_at,item.end_at
        if prefix=='plan':
            item=db.get(PlanItem,int(identity))
            if not item or db.get(Plan,item.plan_id).status.value!='confirmed':error('NOT_FOUND','正式安排已改变，请刷新。',404)
            if item.start_at<=assistant_now():error('CALENDAR_HISTORY','已开始的历史安排保留原始记录，请通过执行反馈更正。',409)
            return prefix,item,item.start_at,item.end_at
        if prefix=='rule':
            rule_id,stamp=identity.split(':',1)
            stamp=datetime.fromisoformat(stamp)
            if stamp.tzinfo is None:raise ValueError('missing timezone')
            stamp=stamp.astimezone(SHANGHAI)
            rule=db.get(TimeRule,int(rule_id))
            if not rule or not rule.active or stamp.time()!=rule.start_time:error('NOT_FOUND','课程或保护时间已改变，请刷新。',404)
            if rule.recurrence.value=='weekly' and stamp.isoweekday()!=rule.weekday or rule.recurrence.value=='once' and stamp.date()!=rule.date:
                error('NOT_FOUND','此规则在该日期没有事项。',404)
            start=datetime.combine(stamp.date(),rule.start_time,SHANGHAI);end=datetime.combine(stamp.date(),rule.end_time,SHANGHAI)
            if db.scalar(select(CalendarEntry.id).where(CalendarEntry.source_rule_id==rule.id,CalendarEntry.source_date==stamp.date())):error('CALENDAR_STALE','该次事项已有调整，请刷新日历。',409)
            return prefix,rule,start,end
    except (ValueError,AttributeError):
        error('INVALID_EVENT','事项标识无效。',422)
    error('CALENDAR_READ_ONLY','此节点来自任务截止或目标，请到对应任务／档案中修改。',422)


@router.post('/changes')
def change_calendar(payload:CalendarChange,db:Session=Depends(get_db)):
    raw=payload.model_dump(mode='json')
    fingerprint=sha256(json.dumps(raw,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    with planning_transaction(db):
        prior=db.scalar(select(CalendarMutation).where(CalendarMutation.request_id==payload.client_request_id))
        if prior:
            if prior.fingerprint!=fingerprint:error('REQUEST_REUSED','请求标识已用于另一项修改，请重新核对后保存。',409)
            return prior.result
        state=get_or_create_planning_state(db)
        if state.revision!=payload.expected_revision:error('CALENDAR_STALE','日程已变化，请刷新并重新核对后保存。',409)
        prefix,item,old_start,old_end=original_event(db,payload.event_id) if payload.event_id else (None,None,None,None)
        if prefix=='plan' and item.task_id:
            profile=db.get(TaskSchedulingProfile,item.task_id)
            if profile and (profile.settings or {}).get('locked'):
                error('TASK_LOCKED','该任务已锁定，请先在任务设置中解锁。',409)
        if payload.action=='save':
            start,end=parse_interval(payload.start,payload.end,payload.all_day)
            if prefix=='plan':
                if item.task_id:
                    task=db.get(Task,item.task_id)
                    if task.status.value!='todo':error('TASK_UNAVAILABLE','已完成或取消的任务不能改期。',409)
                    if payload.all_day or not payload.blocks_time:error('INVALID_TASK_TIME','任务安排需要具体起止时间并占用时间。',422)
                    if end>task.deadline:error('TASK_DEADLINE','安排结束时间超过任务截止时间。',422)
                    if start<assistant_now():error('TASK_PAST','任务不能改排到过去。',422)
                    profile=db.get(TaskSchedulingProfile,task.id)
                    settings=profile.settings if profile else {}
                    if settings.get('locked'):error('TASK_LOCKED','该任务已锁定，请先在任务设置中解锁。',409)
                    segments=db.scalars(select(PlanItem).join(Plan).where(Plan.status=='confirmed',PlanItem.task_id==task.id,PlanItem.id!=item.id,PlanItem.end_at>assistant_now())).all()
                    if any(s.start_at<=assistant_now()<s.end_at for s in segments):
                        error('TASK_IN_PROGRESS','任务有正在执行的分段，请完成反馈后再调整。',409)
                    proposed=sorted([(start,end),*((s.start_at,s.end_at) for s in segments)])
                    delta=int(((end-start)-(old_end-old_start)).total_seconds()/60)
                    old_total=int(sum((s.end_at-s.start_at).total_seconds()/60 for s in segments)+(old_end-old_start).total_seconds()/60)
                    if delta and old_total!=task.duration_minutes:
                        error('TASK_REMAINING_CHANGED','任务剩余时长已变化，与原安排不同。请先按最新剩余时长重新生成安排，再调整分段长度。',409)
                    if task.duration_minutes+delta<=0 or (task.duration_minutes+delta)%5:
                        error('TASK_DURATION','调整后的任务时长必须是正数且为5分钟的倍数。',422)
                    if start.date()!=end.date() or start.time()<time(8) or end.time()>time(22) or start.minute%5 or end.minute%5 or start.second or end.second or start.microsecond or end.microsecond:
                        error('TASK_GRID','任务安排需在当天08:00–22:00内，起止时间使用5分钟粒度。',422)
                    if len(proposed)>1 and (not settings.get('splittable') or len(proposed)>settings.get('max_segments',4)):
                        error('TASK_SEGMENTS','任务分段数量不符合任务设置。',422)
                    if len(proposed)>1 and any((b-a).total_seconds()/60<settings.get('min_block_minutes',30) for a,b in proposed[:-1]):
                        error('TASK_MIN_BLOCK','任务分段短于最小连续时长。',422)
                    if settings.get('fixed_start') and datetime.fromisoformat(settings['fixed_start'])!=proposed[0][0]:
                        error('TASK_FIXED','该任务有指定开始时间，请先在任务设置中调整。',409)
                    windows=settings.get('allowed_windows') or []
                    if windows and not any(datetime.fromisoformat(w['start_at'])<=start and end<=datetime.fromisoformat(w['end_at']) for w in windows):
                        error('TASK_WINDOW','安排超出任务允许的时段。',422)
            if payload.blocks_time:
                from ..services.workspace_views import calendar_events
                # Query all days touched, including cross-midnight busy events.
                finish=(end-timedelta(microseconds=1)).date()+timedelta(days=1)
                snapshot=calendar_events(db,start.date(),finish)
                for event in snapshot['events']:
                    if event['id']==payload.event_id or event.get('blocks_time') is False:continue
                    if event['allDay'] and event['kind']!='calendar':continue
                    a,b=parse_interval(event['start'],event['end'],event['allDay'])
                    if start<b and a<end:error('CALENDAR_CONFLICT',f'与“{event["title"]}”时间重叠，请调整后保存。',409)
        else:
            start,end=old_start,old_end
        if prefix=='plan':
            old_plan=db.get(Plan,item.plan_id)
            if payload.action=='delete':db.delete(item)
            else:
                if item.task_id:
                    task=db.get(Task,item.task_id)
                    task.duration_minutes+=int(((end-start)-(old_end-old_start)).total_seconds()/60)
                    if 'description' in payload.model_fields_set:task.description=payload.description
                    task.updated_at=utc_now()
                item.start_at=start;item.end_at=end;item.title_snapshot=payload.title
                week=start.astimezone(SHANGHAI).date()-timedelta(days=start.astimezone(SHANGHAI).weekday())
                if week!=old_plan.week_start:
                    destination=db.scalar(select(Plan).where(Plan.week_start==week,Plan.status=='confirmed'))
                    if destination is None:
                        destination=Plan(week_start=week,status='confirmed',source_revision=state.revision+1,task_ids=[],confirmed_at=utc_now())
                        db.add(destination);db.flush()
                    item.plan_id=destination.id
                    destination.task_ids=sorted(set([*(destination.task_ids or []),item.task_id]))
            db.flush()
            old_plan.task_ids=sorted(set(db.scalars(select(PlanItem.task_id).where(PlanItem.plan_id==old_plan.id,PlanItem.task_id.is_not(None))).all()))
            event_id=payload.event_id
        else:
            if prefix!='calendar':
                item=CalendarEntry(source_key=f'rule:{item.id}:{old_start.isoformat()}' if prefix=='rule' else None,source_rule_id=item.id if prefix=='rule' else None,
                    source_date=old_start.astimezone(SHANGHAI).date() if prefix=='rule' else None,
                    title=payload.title or item.title,start_at=start,end_at=end)
                db.add(item)
            item.start_at=start;item.end_at=end
            item.deleted=payload.action=='delete'
            if payload.action=='save':
                item.title=payload.title;item.description=payload.description;item.all_day=payload.all_day;item.blocks_time=payload.blocks_time
            db.flush();event_id=f'calendar:{item.id}'
        revision=bump_revision(db)
        result=dict(event_id=event_id,revision=revision,action=payload.action)
        db.add(CalendarMutation(request_id=payload.client_request_id,fingerprint=fingerprint,result=result))
    return result
