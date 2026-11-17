import test from 'node:test'
import assert from 'node:assert/strict'
import {editPlanningTask,planningDraftPayload,planningTaskFields,planningCalendarPreview} from '../src/draftCoordination.js'

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

test('past calendar recording drafts preview their stated interval',()=>{
  const draft={kind:'planning',id:7,status:'ready',calendar_record:true,
    content:{schedule:{title:'升旗仪式',day:'2026-11-16',start_time:'07:30',duration_minutes:30,
      segments:1,break_minutes:0,start_exact:true}},schedule_target:'draft:preview-7',items:[],task_details:[]}
  const preview=planningCalendarPreview(draft,'2026-11-16T15:00:00+08:00')
  assert.equal(preview.events.length,1)
  assert.equal(Date.parse(preview.events[0].start),Date.parse('2026-11-16T07:30:00+08:00'))
  assert.equal(planningCalendarPreview({...draft,calendar_record:false},'2026-11-16T15:00:00+08:00').events.length,1)
})

for(const generic of [false,true]) {
  test(`${generic?'generic':'schedule'} draft previews each local time and duration edit, including past times`,()=>{
    const start='2026-11-16T19:30:00+08:00',end='2026-11-16T20:00:00+08:00',ref='draft:live';
    const fields={title:'升旗仪式',duration_minutes:30,deadline:end,priority:'normal'};
    const draft={id:8,kind:'planning',status:'ready',schedule_target:ref,calendar_record:false,
      content:generic?{actions:[{op:'add',target:ref,fields}]}:{schedule:{...fields,day:'2026-11-16',start_time:'19:30',start_exact:true,segments:1,break_minutes:0}},
      task_details:[{ref,...fields}],items:[{ref,start_at:start,end_at:end}]};
    let content=draft.content;
    function edit(patch,expectedStart,expectedMinutes){
      content=editPlanningTask(draft,content,0,patch);
      const preview=planningCalendarPreview({...draft,preview_content:content},'2026-11-16T15:00:00+08:00');
      assert.equal(preview.events.length,1);
      assert.equal(Date.parse(preview.events[0].start),Date.parse(expectedStart));
      assert.equal((Date.parse(preview.events[0].end)-Date.parse(preview.events[0].start))/60000,expectedMinutes);
    }
    edit({start_at:'2026-11-16T07:30:00+08:00'},'2026-11-16T07:30:00+08:00',30);
    edit({duration_minutes:45},'2026-11-16T07:30:00+08:00',45);
    edit({end_at:'2026-11-16T08:30:00+08:00'},'2026-11-16T07:30:00+08:00',60);
    edit({start_at:'2026-11-16T07:00:00+08:00'},'2026-11-16T07:00:00+08:00',60);
    content=editPlanningTask(draft,content,0,{end_at:''});
    assert.equal(planningCalendarPreview({...draft,preview_content:content},'2026-11-16T15:00:00+08:00').events.length,0);
    edit({end_at:'2026-11-16T08:00:00+08:00'},'2026-11-16T07:00:00+08:00',60);
    assert.equal(draft.items[0].start_at,start);
  })
}
