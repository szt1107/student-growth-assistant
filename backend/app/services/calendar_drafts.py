"""Explicit past intervals use ordinary editable calendar records on confirmation."""
from datetime import datetime, time, timedelta

from fastapi import HTTPException

from ..codex.calendar_api import CalendarChange, validate_calendar_conflicts
from ..models import CalendarEntry
from ..workspace_schemas import SchedulePreview
from .assistant_clock import SHANGHAI
from .conversations import error
from .grid import valid_task_interval
from .planning_state import bump_revision


def record_windows(value):
    if value.work_segments:
        return [(window.start_at, window.end_at) for window in value.work_segments]
    cursor = datetime.combine(value.day, time.fromisoformat(value.start_time), SHANGHAI)
    units, remainder = divmod(value.duration_minutes // 5, value.segments)
    windows = []
    for index in range(value.segments):
        minutes = (units + (index < remainder)) * 5
        end = cursor + timedelta(minutes=minutes)
        windows.append((cursor, end))
        cursor = end + timedelta(minutes=value.break_minutes)
    return windows


def validate_record(db, value):
    if value.task_id:
        error('INVALID_DRAFT', '已有任务请通过任务详情或执行反馈修改。', 422)
    windows = record_windows(value)
    if any((end - start).total_seconds() < value.min_block_minutes * 60 for start, end in windows):
        error('TASK_MIN_BLOCK', '分段时长短于指定的最小连续时长，请核对各段时间。', 422)
    if any((right[0] - left[1]).total_seconds() < value.break_minutes * 60
            for left, right in zip(windows, windows[1:])):
        error('TASK_MIN_BREAK', '分段间隔短于指定休息时间，请核对各段时间。', 422)
    for start, end in windows:
        CalendarChange(title=value.title, start=start.isoformat(), end=end.isoformat(),
            expected_revision=0, client_request_id='calendar-draft-validation')
        if not valid_task_interval(start, end):
            error('TASK_GRID', '请使用5分钟对齐的起止时间，单段最多24小时。', 422)
        if value.deadline and end > value.deadline:
            error('TASK_DEADLINE', '安排结束时间超过截止时间，请核对时段和预计时长。', 422)
        validate_calendar_conflicts(db, start, end)
    return windows


def prepare_record(db, payload, value, target):
    problems = []
    if value.title == '待命名任务':
        problems.append({'code': 'TITLE_REQUIRED', 'message': '请填写这项活动的名称。',
            'suggestion': '填写名称后保存草案。'})
    try:
        windows = validate_record(db, value)
    except HTTPException as exc:
        detail = exc.detail
        problems.append({'code': detail.get('code', 'CALENDAR_CONFLICT'),
            'message': detail.get('message', '这段时间无法保存。'),
            'suggestion': '请核对已有事项，或编辑本次起止时间后保存。'})
        windows = []
    except ValueError:
        problems.append({'code': 'INVALID_DRAFT', 'message': '请核对活动名称和起止时间。',
            'suggestion': '编辑草案后重新保存。'})
        windows = []
    payload.update(
        calendar_record=True, calendar_problems=problems,
        status='conflict' if problems else 'ready', diagnostics=[],
        items=[{'ref': target, 'title': value.title, 'start_at': start.isoformat(),
                'end_at': end.isoformat()} for start, end in windows] if not problems else [],
        questions=[], unresolved=[], alternatives=[], candidate_options=[],
        schedule_adjustments=['这段时间已经过去，将按你给出的时间补录为可编辑的日历事项，确认后保存。'],
        notices=[], summary=f'{value.title} · 日历补录草案',
    )
    return payload


def apply_record(db, proposal):
    """The caller holds the planning transaction and has checked version/revision."""
    value = SchedulePreview.model_validate(proposal.payload['preview_input'])
    windows = validate_record(db, value)
    entries = []
    for index, (start, end) in enumerate(windows):
        entry = CalendarEntry(source_key=f'planning-draft:{proposal.id}:{index}',
            title=value.title, start_at=start, end_at=end,
            description='通过日程草案补录', all_day=False, blocks_time=True)
        db.add(entry)
        entries.append(entry)
    db.flush()
    bump_revision(db)
    proposal.status = 'applied'
    proposal.payload = {**proposal.payload,
        'receipt': {'calendar_entry_ids': [entry.id for entry in entries]}}
