import test from 'node:test'
import assert from 'node:assert/strict'
import {editPlanningTask,planningDraftPayload,planningTaskFields} from '../src/draftCoordination.js'

for(const [start,minutes] of [['2026-11-17T07:30:00+08:00',30],['2026-11-17T00:00:00+08:00',30],['2026-11-17T23:30:00+08:00',60]]) {
  test(`manual draft edits preserve ${start} without a daytime restriction`,()=>{
    const content={schedule:{title:'升旗仪式',day:'2026-11-17',start_time:'08:00',duration_minutes:minutes,
      segments:1,min_block_minutes:5,break_minutes:0,start_exact:false,time_period:'morning',work_segments:[]}}
    const draft={content,schedule_target:'draft:preview-1',items:[],task_details:[]}
    const changed=editPlanningTask(draft,content,0,{start_at:start})
    assert.equal(changed.schedule.start_time,start.slice(11,16))
    assert.equal(changed.schedule.start_exact,true)
    assert.equal(changed.schedule.time_period,null)
    const payload=planningDraftPayload(draft,changed)
    assert.equal(payload.schedule.start_time,start.slice(11,16))
    const task=planningTaskFields(draft,changed)[0]
    assert.equal(Date.parse(task.end_at)-Date.parse(task.start_at),minutes*60000)
  })
}
