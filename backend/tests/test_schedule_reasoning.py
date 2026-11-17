"""Time relationships and semantic fields travel through the normal chat workflow."""
from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AssistantProposal, CalendarEntry
from app.services import draft_defaults, conversation_tools, assistant_clock
from app.workspace_schemas import ToolPlan
from tests.test_ai_skills import call, send
from tests.test_draft_defaults import defaults_chat, ref_of
from tests.test_all_day_schedule import morning

TEXT = '我今天上午七点半到八点进行升旗仪式，帮我安排在日程里'
NOW = datetime.fromisoformat('2026-10-14T18:00:00+08:00')


@pytest.mark.parametrize('text,minutes,end', [
    (TEXT, 30, '2026-10-14T08:00:00+08:00'),
    ('今天7:30-8:00进行升旗仪式，帮我安排', 30, '2026-10-14T08:00:00+08:00'),
    ('今天从七点半至八点进行升旗仪式，帮我安排', 30, '2026-10-14T08:00:00+08:00'),
    ('今天晚上十一点半到十二点进行升旗仪式，帮我安排', 30, '2026-10-15T00:00:00+08:00'),
    ('今天23:30到次日00:30进行升旗仪式，帮我安排', 60, '2026-10-15T00:30:00+08:00'),
])
def test_range_derives_duration_deadline_and_clean_title(text, minutes, end):
    values = draft_defaults.user_values(text, NOW)
    assert values['title'] == '升旗仪式'
    assert values['duration_minutes'] == minutes
    assert values['deadline'] == end


def test_future_range_is_ready_and_confirmable_without_more_questions(client, defaults_chat, morning):
    draft = ref_of(send(client, defaults_chat, TEXT))
    assert draft['status'] == 'ready' and not draft['unresolved']
    assert draft['content']['schedule']['duration_minutes'] == 30
    assert draft['content']['schedule']['deadline'] == '2026-10-14T08:00:00+08:00'
    assert draft['items'][0]['end_at'] == '2026-10-14T08:00:00+08:00'
    assert call(client, '/api/tasks') == []
    saved = call(client, f"/api/workspace/drafts/planning/{draft['id']}/confirm", {'expected_version': draft['version']})
    assert saved['status'] == 'applied'
    assert call(client, '/api/tasks')[0]['duration_minutes'] == 30


def test_past_range_saves_editable_calendar_record_once(client, defaults_chat):
    draft = ref_of(send(client, defaults_chat, TEXT))
    assert draft['status'] == 'ready' and draft['calendar_record']
    assert draft['content']['schedule']['title'] == '升旗仪式'
    assert not draft['problems'] and not draft['unresolved']
    assert call(client, '/api/calendar/events?start=2026-10-14&end=2026-10-15')['events'] == []
    body = {'expected_version': draft['version']}
    saved = call(client, f"/api/workspace/drafts/planning/{draft['id']}/confirm", body)
    repeated = call(client, f"/api/workspace/drafts/planning/{draft['id']}/confirm", body)
    assert saved['status'] == 'applied' and saved['receipt'] == repeated['receipt']
    events = call(client, '/api/calendar/events?start=2026-10-14&end=2026-10-15')['events']
    assert len(events) == 1 and events[0]['kind'] == 'calendar'
    assert datetime.fromisoformat(events[0]['start']) == datetime.fromisoformat('2026-10-14T07:30:00+08:00')
    assert datetime.fromisoformat(events[0]['end']) == datetime.fromisoformat('2026-10-14T08:00:00+08:00')
    changed = client.post('/api/calendar/changes', json={
        'event_id': events[0]['id'], 'title': '升旗仪式更正',
        'start': '2026-10-14T07:20:00+08:00', 'end': '2026-10-14T08:00:00+08:00',
        'expected_revision': call(client, '/api/calendar/events?start=2026-10-14&end=2026-10-15')['revision'],
        'client_request_id': 'past-record-edit'})
    assert changed.status_code == 200, changed.text
    assert call(client, '/api/tasks') == []
    snapshot = call(client, '/api/data/export')
    restored = client.post('/api/data/import', json=snapshot)
    assert restored.status_code == 200, restored.text
    restored_events = call(client, '/api/calendar/events?start=2026-10-14&end=2026-10-15')['events']
    assert len(restored_events) == 1 and restored_events[0]['id'] == events[0]['id']
    assert restored_events[0]['title'] == '升旗仪式更正'
    assert datetime.fromisoformat(restored_events[0]['start']) == datetime.fromisoformat('2026-10-14T07:20:00+08:00')


def test_past_calendar_record_rechecks_occupancy(client, defaults_chat):
    call(client, '/api/time-rules', {'title': '晨间课程', 'kind': 'course', 'recurrence': 'once',
        'date': '2026-10-14', 'start_time': '07:00', 'end_time': '08:00'})
    draft = ref_of(send(client, defaults_chat, TEXT))
    assert draft['status'] == 'conflict' and not draft['items']
    assert any('晨间课程' in problem['message'] for problem in draft['problems'])


def test_calendar_confirmation_is_atomic(client, defaults_chat, monkeypatch, test_engine):
    from app.services import calendar_drafts
    draft = ref_of(send(client, defaults_chat, TEXT))
    def fail_revision(db):
        raise RuntimeError('synthetic write failure')
    monkeypatch.setattr(calendar_drafts, 'bump_revision', fail_revision)
    with pytest.raises(RuntimeError, match='synthetic write failure'):
        client.post(f"/api/workspace/drafts/planning/{draft['id']}/confirm", json={'expected_version': draft['version']})
    with Session(test_engine) as db:
        assert db.scalar(select(CalendarEntry.id)) is None
        assert db.get(AssistantProposal, draft['id']).status == 'ready'


def test_model_interpretation_is_retained_when_it_fills_a_gap(client, defaults_chat, morning, monkeypatch):
    async def interpret(request):
        return ToolPlan(calls=[{'name': 'planning_draft', 'arguments': {'actions': [
            {'op': 'add', 'fields': {'title': '迎新活动', 'duration_minutes': 45,
                'profile': {'preferred_windows': [{'start_at': '2026-10-15T14:30:00+08:00',
                    'end_at': '2026-10-15T18:00:00+08:00'}]}}}]}}])
    monkeypatch.setattr(conversation_tools, 'plan', interpret)
    draft = ref_of(send(client, defaults_chat, '明天下午参加迎新活动，按刚讨论的预计时间安排，帮我安排'))
    assert draft['content']['schedule']['duration_minutes'] == 45
    assert draft['content']['schedule']['start_time'] == '14:30'
    assert draft['field_sources']['duration_minutes'] == 'ai_interpretation'


def test_explicit_range_wins_over_model_default_fields(client, defaults_chat, morning, monkeypatch):
    async def inaccurate(request):
        return ToolPlan(calls=[{'name': 'planning_draft', 'arguments': {'actions': [
            {'op': 'add', 'fields': {'title': '待命名任务', 'duration_minutes': 60,
                'profile': {'fixed_start': '2026-10-14T08:00:00+08:00'}}}]}}])
    monkeypatch.setattr(conversation_tools, 'plan', inaccurate)
    draft = ref_of(send(client, defaults_chat, TEXT))
    assert draft['status'] == 'ready'
    assert draft['content']['schedule']['duration_minutes'] == 30
    assert draft['content']['schedule']['title'] == '升旗仪式'


def test_range_and_duration_contradiction_is_not_silently_accepted(client, defaults_chat, morning):
    draft = ref_of(send(client, defaults_chat, '今天七点半到八点进行升旗仪式，预计60分钟，帮我安排'))
    assert draft['status'] in ('conflict', 'no_plan') and not draft['items']
    assert any(problem['code'] == 'INSUFFICIENT_TIME' for problem in draft['problems'])
    assert draft['content']['schedule']['duration_minutes'] == 60
    assert draft['content']['schedule']['deadline'] == '2026-10-14T08:00:00+08:00'


def test_legacy_range_draft_can_be_recalculated_and_saved(client, defaults_chat, test_engine):
    draft = ref_of(send(client, defaults_chat, TEXT))
    with Session(test_engine) as db:
        row = db.get(AssistantProposal, draft['id'])
        row.payload = {**row.payload, 'start_policy_version': 4, 'calendar_record': False,
            'preview_input': {**row.payload['preview_input'], 'title': '到进行升旗仪式',
                'duration_minutes': 60, 'deadline': None}}
        row.status = 'conflict'
        db.commit()
    restored = call(client, f"/api/workspace/drafts/planning/{draft['id']}")
    assert restored['requires_recalculation']
    assert restored['content']['schedule']['title'] == '升旗仪式'
    assert restored['content']['schedule']['duration_minutes'] == 30
    result = client.patch(f"/api/workspace/drafts/planning/{draft['id']}", json={
        'expected_version': restored['version'], 'content': restored['content']})
    assert result.status_code == 200, result.text
    assert result.json()['status'] == 'ready' and result.json()['calendar_record']


def test_explicit_past_date_can_precede_current_planning_week(client, defaults_chat, monkeypatch):
    monday = datetime.fromisoformat('2026-10-12T15:00:00+08:00')
    monkeypatch.setattr(assistant_clock, 'assistant_now', lambda: monday)
    monkeypatch.setattr(conversation_tools, 'assistant_now', lambda: monday)
    draft = ref_of(send(client, defaults_chat, '昨天上午七点半到八点进行升旗仪式，帮我安排在日程里'))
    assert draft['status'] == 'ready' and draft['calendar_record']
    assert draft['items'][0]['start_at'] == '2026-10-11T07:30:00+08:00'


def test_model_can_understand_separate_start_and_finish_clauses(client, defaults_chat, morning, monkeypatch):
    async def interpret(request):
        return ToolPlan(calls=[{'name': 'planning_draft', 'arguments': {'actions': [
            {'op': 'add', 'fields': {'title': '迎新活动', 'duration_minutes': 60,
                'deadline': '2026-10-15T10:00:00+08:00',
                'profile': {'fixed_start': '2026-10-15T09:00:00+08:00'}}}]}}])
    monkeypatch.setattr(conversation_tools, 'plan', interpret)
    draft = ref_of(send(client, defaults_chat, '明天上午九点开始参加迎新活动，十点结束，帮我安排'))
    assert draft['status'] == 'ready'
    assert draft['content']['schedule']['duration_minutes'] == 60
    assert draft['content']['schedule']['deadline'] == '2026-10-15T10:00:00+08:00'
    assert draft['field_sources']['deadline'] == 'ai_interpretation'


@pytest.mark.parametrize('minimum,rest,code', [(20,0,'TASK_MIN_BLOCK'),(5,10,'TASK_MIN_BREAK')])
def test_past_record_honors_explicit_split_constraints(client, defaults_chat, minimum, rest, code):
    draft = ref_of(send(client, defaults_chat, TEXT))
    content = draft['content']
    content['schedule'].update(duration_minutes=40, segments=2, min_block_minutes=minimum,
        break_minutes=rest, deadline='2026-10-14T09:00:00+08:00', work_segments=[
            {'start_at':'2026-10-14T07:30:00+08:00','end_at':'2026-10-14T07:45:00+08:00'},
            {'start_at':'2026-10-14T07:50:00+08:00','end_at':'2026-10-14T08:15:00+08:00'}])
    result = client.patch(f"/api/workspace/drafts/planning/{draft['id']}",
        json={'expected_version':draft['version'],'content':content})
    assert result.status_code == 200, result.text
    assert result.json()['status'] == 'conflict'
    assert any(problem['code']==code for problem in result.json()['problems'])
