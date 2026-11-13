from datetime import datetime, date
from sqlalchemy import select


def revision(client):
    return client.get('/api/calendar/events?start=2026-11-02&end=2026-11-09').json()['revision']


def change(client, **kw):
    body = dict(action='save', title='独立日程', start='2026-11-02T14:00:00+08:00',
                end='2026-11-02T15:00:00+08:00', all_day=False, blocks_time=True,
                expected_revision=revision(client), client_request_id='calendar-test-1')
    body.update(kw)
    return client.post('/api/calendar/changes', json=body)


def events(client, start='2026-11-02', end='2026-11-09'):
    return client.get(f'/api/calendar/events?start={start}&end={end}').json()['events']


def test_calendar_create_idempotent_update_delete(client):
    before=revision(client)
    response=change(client)
    assert response.status_code==200, response.text
    event_id=response.json()['event_id']
    assert len(events(client))==1
    # Exact replay succeeds even though the old revision is now stale.
    assert change(client,expected_revision=before).json()==response.json()
    assert change(client,title='不同内容',expected_revision=before).status_code==409
    assert change(client,event_id=event_id,title='已改名',client_request_id='edit-1').status_code==200
    assert events(client)[0]['title']=='已改名'
    assert change(client,action='delete',event_id=event_id,client_request_id='delete-1').status_code==200
    assert events(client)==[]


def test_calendar_conflicts_stale_and_invalid_are_atomic(client):
    assert change(client).status_code==200
    assert change(client,client_request_id='overlap').status_code==409
    assert change(client,client_request_id='stale',expected_revision=0).status_code==409
    assert change(client,client_request_id='backwards',end='2026-11-02T13:00:00+08:00').status_code==422
    assert change(client,client_request_id='naive',start='2026-11-03T14:00:00').status_code==422
    assert len(events(client))==1


def test_calendar_all_day_exclusive_and_cross_midnight(client):
    assert change(client,all_day=True,start='2026-11-03',end='2026-11-05').status_code==200
    item=events(client)[0]
    assert item['start']=='2026-11-03' and item['end']=='2026-11-05' and item['allDay']
    assert change(client,start='2026-11-05T23:00:00+08:00',end='2026-11-06T01:00:00+08:00',client_request_id='overnight').status_code==200
    assert len(events(client))==2


def test_calendar_new_busy_time_is_visible_to_scheduler(client):
    assert change(client).status_code==200
    from app.database import get_db
    from app.main import app
    from app.services.assistant_state import time_rules
    from app.services.validator import expand_time_rules
    with next(app.dependency_overrides[get_db]()) as db:
        spans=expand_time_rules(date(2026,11,2),time_rules(db))
        assert any(x.start_at.hour==14 and x.end_at.hour==15 for x in spans)


def test_calendar_rule_exception_changes_only_one_occurrence(client):
    rule=client.post('/api/time-rules',json=dict(kind='course',title='每周课程',recurrence='weekly',weekday=1,start_time='09:00',end_time='10:00')).json()
    occurrence=next(e for e in events(client) if e['kind']=='course')
    assert change(client,event_id=occurrence['id'],title='单次改期',start='2026-11-02T10:00:00+08:00',end='2026-11-02T11:00:00+08:00').status_code==200
    first=events(client);assert len(first)==1 and first[0]['title']=='单次改期'
    next_week=events(client,'2026-11-09','2026-11-16')
    assert len(next_week)==1 and next_week[0]['title']=='每周课程'


def test_calendar_json_export_restore_contains_new_events(client):
    assert change(client).status_code==200
    from app.database import get_db
    from app.main import app
    from app.services.growth_data import build_snapshot, _prepare_snapshot
    with next(app.dependency_overrides[get_db]()) as db:
        snapshot=build_snapshot(db)
        assert len(snapshot['tables']['calendar_entries'])==1
        _prepare_snapshot(snapshot)


def seed_task(test_engine, split=False):
    from app.models import Task, Plan, PlanItem, TaskSchedulingProfile
    from sqlalchemy.orm import Session
    with Session(test_engine) as db:
        task=Task(title='关联任务',duration_minutes=120 if split else 60,deadline=datetime.fromisoformat('2026-12-01T22:00:00+08:00'))
        db.add(task);db.flush()
        plan=Plan(week_start=date(2026,11,2),status='confirmed',source_revision=0,task_ids=[task.id])
        db.add(plan);db.flush()
        item=PlanItem(plan_id=plan.id,kind='task',task_id=task.id,title_snapshot=task.title,
            start_at=datetime.fromisoformat('2026-11-02T09:00:00+08:00'),end_at=datetime.fromisoformat('2026-11-02T10:00:00+08:00'))
        db.add(item);db.flush();ids=[item.id]
        if split:
            other=PlanItem(plan_id=plan.id,kind='task',task_id=task.id,title_snapshot=task.title,
                start_at=datetime.fromisoformat('2026-11-02T14:00:00+08:00'),end_at=datetime.fromisoformat('2026-11-02T15:00:00+08:00'))
            db.add(other);db.add(TaskSchedulingProfile(task_id=task.id,settings={'splittable':True,'min_block_minutes':30,'max_segments':2,'fixed_start':'2026-11-02T09:00:00+08:00'}));db.flush();ids.append(other.id)
        tid=task.id;db.commit()
    return tid,ids


def test_task_cross_week_and_delete_keeps_task(client,test_engine):
    from app.services.assistant_state import baseline
    from app.models import Task
    from sqlalchemy.orm import Session
    tid,ids=seed_task(test_engine)
    assert change(client,event_id=f'plan:{ids[0]}',start='2026-11-23T09:00:00+08:00',end='2026-11-23T10:00:00+08:00').status_code==200
    with Session(test_engine) as db:
        assert baseline(db,date(2026,11,23))[1][0]['ref']==f'task:{tid}'
    assert change(client,event_id=f'plan:{ids[0]}',action='delete',client_request_id='remove-task').status_code==200
    with Session(test_engine) as db:assert db.get(Task,tid) is not None


def test_task_resize_updates_estimate_and_rejects_invalid_grid(client,test_engine):
    from app.models import Task
    from sqlalchemy.orm import Session
    tid,ids=seed_task(test_engine)
    assert change(client,event_id=f'plan:{ids[0]}',start='2026-11-02T09:00:00+08:00',end='2026-11-02T09:01:00+08:00').status_code==422
    assert change(client,event_id=f'plan:{ids[0]}',description='修改任务说明',start='2026-11-02T09:00:00+08:00',end='2026-11-02T10:30:00+08:00',client_request_id='resize-valid').status_code==200
    with Session(test_engine) as db:
        assert db.get(Task,tid).duration_minutes==90
        assert db.get(Task,tid).description=='修改任务说明'
    assert next(e for e in events(client) if e['id']==f'plan:{ids[0]}')['description']=='修改任务说明'


def test_split_fixed_start_only_applies_to_first_segment(client,test_engine):
    tid,ids=seed_task(test_engine,True)
    response=change(client,event_id=f'plan:{ids[1]}',title='第二段改名')
    assert response.status_code==200,response.text


def test_legacy_planner_sees_new_busy_and_removed_rule(client,test_engine):
    from app.services.plan_safety import prepare_plan_rules
    from app.services.validator import expand_time_rules
    from sqlalchemy.orm import Session
    assert change(client).status_code==200
    with Session(test_engine) as db:
        rules=prepare_plan_rules(db,date(2026,11,2),[],None,datetime.fromisoformat('2026-10-30T08:00:00+08:00'))
        assert any(s.start_at.hour==14 for s in expand_time_rules(date(2026,11,2),rules))


def test_invalid_calendar_backup_is_rejected_before_restore(client):
    from copy import deepcopy
    assert change(client).status_code==200
    snapshot=client.get('/api/data/export').json()
    for fields in ({'title':''},{'end_at':'2100-01-01T00:00:00+00:00'},{'all_day':True},{'source_date':'2026-11-02'}):
        bad=deepcopy(snapshot);bad['tables']['calendar_entries'][0].update(fields)
        assert client.post('/api/data/import',json=bad).status_code==422
        assert len(events(client))==1


def test_rule_exception_survives_week_change_with_historical_snapshot(client,test_engine,monkeypatch):
    from sqlalchemy.orm import Session
    from app.models import Plan,PlanItem,TimeRule
    from app.services import workspace_views
    rule=client.post('/api/time-rules',json=dict(kind='course',title='周期课',recurrence='weekly',weekday=1,start_time='09:00',end_time='10:00')).json()
    original=next(e for e in events(client) if e['kind']=='course')
    with Session(test_engine) as db:
        plan=Plan(week_start=date(2026,11,2),status='confirmed',source_revision=0,task_ids=[]);db.add(plan);db.flush()
        db.add(PlanItem(plan_id=plan.id,kind='course',time_rule_id=rule['id'],title_snapshot='周期课',start_at=datetime.fromisoformat(original['start']),end_at=datetime.fromisoformat(original['end'])));db.commit()
    assert change(client,event_id=original['id'],start='2026-11-03T09:00:00+08:00',end='2026-11-03T10:00:00+08:00').status_code==200
    monkeypatch.setattr(workspace_views,'assistant_now',lambda:datetime.fromisoformat('2026-11-09T08:00:00+08:00'))
    after=events(client)
    assert len(after)==1 and after[0]['kind']=='calendar'


def test_locked_task_cannot_be_removed(client,test_engine):
    from app.models import TaskSchedulingProfile
    from sqlalchemy.orm import Session
    tid,ids=seed_task(test_engine)
    with Session(test_engine) as db:db.add(TaskSchedulingProfile(task_id=tid,settings={'locked':True}));db.commit()
    assert change(client,event_id=f'plan:{ids[0]}',action='delete').status_code==409
    assert any(e['id']==f'plan:{ids[0]}' for e in events(client))


def test_resize_cannot_corrupt_changed_remaining_minutes(client,test_engine):
    from app.models import Task
    from sqlalchemy.orm import Session
    tid,ids=seed_task(test_engine)
    with Session(test_engine) as db:db.get(Task,tid).duration_minutes=30;db.commit()
    result=change(client,event_id=f'plan:{ids[0]}',start='2026-11-02T09:00:00+08:00',end='2026-11-02T09:05:00+08:00')
    assert result.status_code==409
    with Session(test_engine) as db:assert db.get(Task,tid).duration_minutes==30
