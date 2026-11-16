"""Explicit user occasions survive parsing, edits, conflicts and confirmation."""
from datetime import date, datetime, time

import pytest
from sqlalchemy.orm import Session

from app.models import AssistantProposal
from app.services import assistant_clock, conversation_tools, draft_defaults
from app.services.assistant_scheduler import arrange, validate_assistant
from app.services.scheduling_types import SHANGHAI
from tests.test_ai_skills import call, send
from tests.test_draft_defaults import defaults_chat, ref_of
from tests.codex.test_calendar_editing import seed_task, change

NOW = datetime(2026, 10, 14, 6, tzinfo=SHANGHAI)
TEXT = '我今天早上要进行升旗仪式，七点半开始，预计半个小时，请你帮我规划草案'


@pytest.fixture
def morning(monkeypatch):
    monkeypatch.setattr(assistant_clock, 'assistant_now', lambda: NOW)
    monkeypatch.setattr(conversation_tools, 'assistant_now', lambda: NOW)


@pytest.mark.parametrize('text,title,clock,minutes', [
    (TEXT, '升旗仪式', '07:30', 30),
    ('明早七点半要进行升旗仪式预计半个小时请你帮我规划草案', '升旗仪式', '07:30', 30),
    ('明天凌晨一点半参加线上会议，半个小时，帮我安排', '线上会议', '01:30', 30),
    ('明天晚上十一点半进行设备维护，1个半小时，请帮我安排', '设备维护', '23:30', 90),
    ('明天上午五点半参加马拉松，两个小时，帮我安排', '马拉松', '05:30', 120),
    ('明天7:30参加升旗仪式，30分钟，帮我安排', '升旗仪式', '07:30', 30),
])
def test_explicit_occasions(text, title, clock, minutes):
    value, sources = draft_defaults.schedule({'message': text}, NOW)
    assert (value.title, value.start_time, value.duration_minutes) == (title, clock, minutes)
    assert value.start_exact and value.time_period is None
    assert sources['title'] == sources['start_time'] == sources['duration_minutes'] == 'user_explicit'


@pytest.mark.parametrize('text', ['明天七点半左右参加升旗仪式，帮我安排', '明天七点半参加升旗仪式，时间灵活，帮我安排'])
def test_only_explicit_flexibility_can_move_a_clock(text):
    value, _ = draft_defaults.schedule({'message': text}, NOW)
    assert value.start_time == '07:30' and not value.start_exact


def test_no_clock_defaults_to_eight_and_full_day_is_available():
    value, _ = draft_defaults.schedule({'message': '明天参加升旗仪式，帮我安排'}, NOW)
    assert value.start_time == '08:00' and not value.start_exact
    begin, end = draft_defaults.day_window(value.day)
    assert begin.hour == end.hour == 0 and (end-begin).total_seconds() == 86400


def test_user_screenshot_creates_named_half_hour_draft(client, defaults_chat, morning):
    draft = ref_of(send(client, defaults_chat, TEXT))
    value = draft['content']['schedule']
    assert (value['title'], value['start_time'], value['duration_minutes']) == ('升旗仪式', '07:30', 30)
    assert draft['items'][0]['start_at'] == '2026-10-14T07:30:00+08:00'
    assert draft['items'][0]['end_at'] == '2026-10-14T08:00:00+08:00'
    assert not any(problem['code'] == 'TITLE_REQUIRED' for problem in draft['problems'])
    assert call(client, '/api/tasks') == []


def test_manual_draft_time_can_move_before_eight_and_confirm(client, defaults_chat, morning):
    draft = ref_of(send(client, defaults_chat, '今天参加升旗仪式，半个小时，帮我安排'))
    content = draft['content']
    content['schedule'].update(start_time='07:30', start_exact=True, time_period=None,
        deadline='2026-10-14T08:00:00+08:00')
    result = client.patch(f"/api/workspace/drafts/planning/{draft['id']}", json={
        'expected_version': draft['version'], 'content': content})
    assert result.status_code == 200, result.text
    changed = result.json()
    assert changed['status'] == 'ready'
    assert changed['items'][0]['start_at'] == '2026-10-14T07:30:00+08:00'
    saved = call(client, f"/api/workspace/drafts/planning/{draft['id']}/confirm", {'expected_version': changed['version']})
    assert saved['status'] == 'applied'
    assert call(client, '/api/tasks')[0]['title'] == '升旗仪式'


def test_fixed_time_conflict_does_not_shift_or_write(client, defaults_chat, morning):
    call(client, '/api/time-rules', {'title': '晨间课程', 'kind': 'course', 'recurrence': 'once',
        'date': '2026-10-14', 'start_time': '07:00', 'end_time': '08:00'})
    draft = ref_of(send(client, defaults_chat, TEXT))
    assert draft['status'] == 'conflict' and not draft['items']
    assert draft['content']['schedule']['start_time'] == '07:30'
    assert any('晨间课程' in problem['message'] for problem in draft['problems'])
    assert call(client, '/api/tasks') == []


def test_past_explicit_clock_stays_in_conflict(client, defaults_chat):
    draft = ref_of(send(client, defaults_chat, TEXT))
    assert draft['status'] == 'conflict' and not draft['items']
    assert draft['content']['schedule']['start_time'] == '07:30'
    assert any(problem['code'] == 'START_IN_PAST' for problem in draft['problems'])


@pytest.mark.parametrize('clock,minutes', [('00:00', 30), ('05:30', 30), ('07:30', 30), ('23:30', 30), ('23:30', 60), ('00:00', 1440)])
def test_engine_all_hours_midnight_and_24_hour_duration(clock, minutes):
    task = {'ref': 'draft:early', 'title': '活动', 'duration_minutes': minutes, 'priority': 'normal',
        'deadline': '2026-10-16T23:59:00+08:00', 'profile': {'fixed_start': f'2026-10-15T{clock}:00+08:00'}}
    result = arrange(date(2026, 10, 12), NOW, [task], [], [])
    assert result['status'] == 'ready', result
    assert result['items'][0]['start_at'] == task['profile']['fixed_start']
    assert validate_assistant(date(2026, 10, 12), NOW, [task], [], result['items'], []) == []


def test_late_night_preview_can_cross_midnight(client, defaults_chat, morning):
    draft = ref_of(send(client, defaults_chat, '明天晚上十一点半进行设备维护，一个小时，帮我安排'))
    assert draft['items'][0]['start_at'] == '2026-10-15T23:30:00+08:00'
    assert draft['items'][0]['end_at'] == '2026-10-16T00:30:00+08:00'


def test_free_calendar_windows_cover_the_full_day(client):
    data = call(client, '/api/calendar/events?start=2026-10-15&end=2026-10-16')
    assert data['free'] == [{'start': '2026-10-15T00:00:00+08:00', 'end': '2026-10-16T00:00:00+08:00'}]


@pytest.mark.parametrize('begin,end', [('07:30', '08:30'), ('00:00', '01:00'), ('23:00', '24:00')])
def test_formal_calendar_task_can_be_edited_at_any_hour(client, test_engine, monkeypatch, begin, end):
    monkeypatch.setattr(assistant_clock, 'assistant_now', lambda: datetime(2026, 10, 30, tzinfo=SHANGHAI))
    from app.services import workspace_views
    monkeypatch.setattr(workspace_views, 'assistant_now', assistant_clock.assistant_now)
    _, ids = seed_task(test_engine)
    end_at = f'2026-11-03T00:00:00+08:00' if end == '24:00' else f'2026-11-02T{end}:00+08:00'
    result = change(client, event_id=f'plan:{ids[0]}', start=f'2026-11-02T{begin}:00+08:00', end=end_at)
    assert result.status_code == 200, result.text


def test_existing_bad_draft_recovers_user_intent_without_rewriting_on_read(client, defaults_chat, morning, test_engine):
    draft = ref_of(send(client, defaults_chat, TEXT))
    with Session(test_engine) as db:
        row = db.get(AssistantProposal, draft['id'])
        value = dict(row.payload['preview_input'], title='待命名任务', start_time='08:00', start_exact=False,
            duration_minutes=60, time_period='morning')
        row.payload = {**row.payload, 'preview_input': value, 'start_policy_version': 3,
            'field_sources': {**row.payload['field_sources'], 'title': 'unresolved',
                'duration_minutes': 'system_default', 'start_time': 'schedule_adjusted',
                'start_exact': 'user_explicit', 'time_period': 'user_explicit'}}
        db.commit()
    restored = call(client, f"/api/workspace/drafts/planning/{draft['id']}")
    assert restored['requires_recalculation'] and restored['items'] == []
    assert not any(problem['code']=='TITLE_REQUIRED' for problem in restored['problems'])
    assert restored['content']['schedule']['title'] == '升旗仪式'
    assert restored['content']['schedule']['start_time'] == '07:30'
    assert restored['content']['schedule']['start_exact'] and restored['content']['schedule']['time_period'] is None
    assert restored['content']['schedule']['duration_minutes'] == 30
    with Session(test_engine) as db:
        assert db.get(AssistantProposal, draft['id']).payload['preview_input']['title'] == '待命名任务'


def test_model_cannot_replace_the_users_named_time_and_duration(client, defaults_chat, morning, monkeypatch):
    from app.workspace_schemas import ToolPlan
    async def inaccurate(request):
        return ToolPlan(calls=[{'name':'planning_draft','arguments':{'actions':[{'op':'add','fields':{
            'title':'待命名任务','duration_minutes':60,'deadline':'2026-10-14T10:00:00+08:00',
            'profile':{'fixed_start':'2026-10-14T08:00:00+08:00'}}}]}}])
    monkeypatch.setattr(conversation_tools,'plan',inaccurate)
    draft=ref_of(send(client,defaults_chat,TEXT))
    value=draft['content']['schedule']
    assert value['title']=='升旗仪式' and value['duration_minutes']==30
    assert value['start_time']=='07:30' and value['start_exact']
    assert value['deadline'] is None  # The model cannot invent a user deadline.
    assert draft['items'][0]['start_at']=='2026-10-14T07:30:00+08:00'


def test_deadline_only_followup_does_not_rename_the_activity():
    assert 'title' not in draft_defaults.user_values('今晚22点前完成',NOW)


def test_multiday_split_does_not_merge_into_an_overlong_segment():
    task={'ref':'draft:long','title':'长活动','duration_minutes':1800,'priority':'normal',
        'deadline':'2026-10-17T00:00:00+08:00','profile':{'splittable':True,'min_block_minutes':30,'max_segments':3}}
    result=arrange(date(2026,10,12),NOW,[task],[],[])
    assert result['status']=='ready',result
    assert len(result['items'])>=2
    assert validate_assistant(date(2026,10,12),NOW,[task],[],result['items'],[])==[]
