import test from 'node:test'
import assert from 'node:assert/strict'
import {toDayFlowEvent, fieldsFromEvent, calendarRange, miniMonth} from '../../src/codex/dayflow.js'

test('timed events preserve the Shanghai instant and original IDs',()=>{
 const event=toDayFlowEvent({id:'plan:9',title:'任务',start:'2026-11-02T06:00:00Z',end:'2026-11-02T07:00:00Z',kind:'formal_task',task_id:3})
 assert.equal(event.start.hour,14)
 assert.equal(event.meta.source.task_id,3)
 assert.equal(fieldsFromEvent(event).start,'2026-11-02T14:00')
 assert.equal(fieldsFromEvent(event).event_id,'plan:9')
})
test('all-day end stays exclusive with no timezone shift',()=>{
 const event=toDayFlowEvent({id:'calendar:8',title:'跨日',start:'2026-11-02',end:'2026-11-05',allDay:true,kind:'calendar'})
 assert.equal(fieldsFromEvent(event).end,'2026-11-05')
 assert.equal(event.start.toString(),'2026-11-02')
})
test('deadline markers without an end get a one-day exclusive span',()=>{
 const event=toDayFlowEvent({id:'deadline:2',title:'截止',start:'2026-11-02',allDay:true,kind:'deadline'})
 assert.equal(event.end.toString(),'2026-11-03')
 assert.equal(event.calendarId,'markers')
})
test('week begins Monday, leap year range and mini-month are bounded',()=>{
 assert.deepEqual(calendarRange('2026-11-01','week'),{start:'2026-10-26',end:'2026-11-02'})
 assert.deepEqual(calendarRange('2024-02-29','year'),{start:'2024-01-01',end:'2025-01-01'})
 const cells=miniMonth('2026-11-01');assert.equal(cells.length,42);assert.equal(cells[0],'2026-10-26')
})
