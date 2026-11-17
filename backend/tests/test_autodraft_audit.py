"""Regression audit: soft defaults, activity boundaries, durable public progress."""
from datetime import datetime
import pytest
from sqlalchemy.orm import Session
from app.models import AssistantProposal
from app.services import draft_defaults, conversation_tools
from app.workspace_schemas import ToolPlan
from tests.test_ai_skills import call, send
from tests.test_draft_defaults import defaults_chat, ref_of

NOW=datetime.fromisoformat('2026-10-14T18:00:00+08:00')
TEXT='晚上我还想写一下软件工程演讲稿，预计1个小时左右，请你帮我安排'


@pytest.mark.parametrize('period,start', [('上午','08:00'),('下午','14:00'),('晚上','19:00')])
def test_model_default_is_never_a_user_fixed_start(period,start):
    value,_=draft_defaults.schedule({'message':f'明天{period}写软件工程演讲稿，预计1小时'},NOW,
        interpreted_fields={'title':'软件工程演讲稿','profile':{'fixed_start':f'2026-10-15T{start}:00+08:00'}})
    assert not value.start_exact and value.time_period


@pytest.mark.parametrize('text,start', [('明晚七点开始写演讲稿，预计1小时','19:00'),
    ('明天7:30到8:00进行升旗仪式','07:30'),('明晚八点开始写演讲稿','20:00')])
def test_explicit_user_clock_remains_fixed(text,start):
    value,_=draft_defaults.schedule({'message':text},NOW,interpreted_fields={
        'profile':{'fixed_start':'2026-10-15T19:00:00+08:00'}})
    assert value.start_exact and value.start_time==start


def test_broad_period_edit_releases_old_clock_but_keeps_other_fields():
    original,_=draft_defaults.schedule({'message':'明天晚上七点写报告，预计1小时，22点截止'},NOW)
    changed,_=draft_defaults.schedule({'message':'改到明天下午'},NOW,base=original.model_dump(mode='json'))
    assert changed.time_period=='afternoon' and not changed.start_exact
    assert changed.title==original.title and changed.deadline==original.deadline


def test_new_activity_does_not_inherit_old_task_time_or_deadline():
    value,_=draft_defaults.schedule({'message':TEXT,'history':[{'role':'user',
        'text':'今天晚上七点开始写操作系统作业，预计90分钟，20:30截止'}]},NOW)
    assert value.title=='软件工程演讲稿' and value.duration_minutes==60
    assert not value.start_exact and value.deadline is None
    assert value.day==NOW.date()


@pytest.mark.parametrize('text', ['晚上写软件工程演讲稿，帮我安排到日程里','今天九点写报告，结束后休息一下'])
def test_destination_or_incidental_finish_word_does_not_authorize_model_deadline(text):
    value,_=draft_defaults.schedule({'message':text},NOW,interpreted_fields={
        'deadline':'2026-10-14T22:00:00+08:00'})
    assert value.deadline is None


@pytest.mark.parametrize('model', [False,True])
@pytest.mark.parametrize('occupied_start',['18:00','19:00'])
def test_real_occupancy_is_automatically_avoided_for_soft_evening_start(client,defaults_chat,monkeypatch,model,occupied_start):
    call(client,'/api/time-rules',{'title':'操作系统作业','kind':'protected','recurrence':'once',
        'date':'2026-10-14','start_time':occupied_start,'end_time':'20:30'})
    if model:
        async def pin(request):
            return ToolPlan(calls=[{'name':'planning_draft','arguments':{'actions':[{'op':'add','fields':{
                'title':'软件工程演讲稿','duration_minutes':60,'profile':{'fixed_start':'2026-10-14T19:00:00+08:00'}}}]}}])
        monkeypatch.setattr(conversation_tools,'plan',pin)
    result=send(client,defaults_chat,TEXT)
    draft=ref_of(result);value=draft['content']['schedule']
    assert value['title']=='软件工程演讲稿' and not value['start_exact']
    assert draft['items'] and draft['status']=='needs_input'  # real deadline remains editable
    assert all('2026-10-14T20:30'<=item['start_at']<'2026-10-15' for item in draft['items'])
    assert not any(problem['code']=='TIME_OCCUPIED' for problem in draft['problems'])
    assert '模型处理未完成' not in result['delta']
    assert result['content']['progress'][-1]['status']=='done'
    assert any(step['phase']=='calculating' for step in result['content']['progress'])
    assert call(client,'/api/tasks')==[]


def test_another_named_activity_creates_new_draft_while_old_one_is_pending(client,defaults_chat):
    first=ref_of(send(client,defaults_chat,'今天晚上写操作系统作业，预计90分钟'))
    second=ref_of(send(client,defaults_chat,TEXT,'second'))
    assert first['id']!=second['id']
    assert call(client,f"/api/workspace/drafts/planning/{first['id']}")['content']==first['content']


def test_confirmed_task_is_preserved_while_new_evening_activity_moves_after_it(client,defaults_chat):
    first=ref_of(send(client,defaults_chat,'今天晚上七点到八点半写操作系统作业，帮我安排'))
    call(client,f"/api/workspace/drafts/planning/{first['id']}/confirm",{'expected_version':first['version']})
    before=call(client,'/api/tasks')
    second=ref_of(send(client,defaults_chat,TEXT,'next-activity'))
    assert second['content']['schedule']['deadline'] is None
    own=[item for item in second['items'] if item['ref']==second['schedule_target']]
    # Existing soft break preferences may leave a short gap after the task.
    assert '2026-10-14T20:30'<=own[0]['start_at']<'2026-10-14T22:00'
    assert (datetime.fromisoformat(own[0]['end_at'])-datetime.fromisoformat(own[0]['start_at'])).total_seconds()==3600
    preserved=[item for item in second['items'] if item['ref']==f"task:{before[0]['id']}"]
    assert preserved[0]['start_at']=='2026-10-14T19:00:00+08:00'
    assert call(client,'/api/tasks')==before


def test_explicit_clock_conflict_is_not_silently_rescheduled(client,defaults_chat):
    call(client,'/api/time-rules',{'title':'操作系统作业','kind':'protected','recurrence':'once',
        'date':'2026-10-14','start_time':'19:00','end_time':'20:30'})
    draft=ref_of(send(client,defaults_chat,'今晚七点开始写软件工程演讲稿，预计1小时，22点截止，帮我安排'))
    assert draft['content']['schedule']['start_time']=='19:00'
    assert draft['content']['schedule']['start_exact'] and not draft['items']
    assert any(problem['code']=='TIME_OCCUPIED' for problem in draft['problems'])


def test_policy5_model_clock_is_repaired_without_changing_manual_edits(client,defaults_chat,test_engine):
    result=send(client,defaults_chat,TEXT);draft=ref_of(result)
    with Session(test_engine) as db:
        row=db.get(AssistantProposal,draft['id'])
        row.payload={**row.payload,'start_policy_version':5,'field_sources':{
            **row.payload['field_sources'],'start_exact':'ai_interpretation'},
            'preview_input':{**row.payload['preview_input'],'start_exact':True}}
        db.commit()
    recovered=call(client,f"/api/workspace/drafts/planning/{draft['id']}")
    assert recovered['requires_recalculation'] and not recovered['content']['schedule']['start_exact']
    with Session(test_engine) as db:
        row=db.get(AssistantProposal,draft['id']);row.payload={**row.payload,'edit_receipt':{'key':'manual'}};db.commit()
    assert call(client,f"/api/workspace/drafts/planning/{draft['id']}")['content']['schedule']['start_exact']
