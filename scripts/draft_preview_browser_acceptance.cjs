// Run against integration_demo.py only; edits must repaint before blur/save.
const runtime=process.env.SGA_PLAYWRIGHT_PATH || 'playwright';
const {chromium}=require(runtime);
const {expect}=require(runtime+'/test');
const assert=require('node:assert/strict');
const api=process.env.SGA_TEST_API || 'http://127.0.0.1:8029';
const web=process.env.SGA_TEST_WEB || 'http://127.0.0.1:5187';
async function call(path,method='GET',body){
 const response=await fetch(api+path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 assert.equal(response.headers.get('x-sga-integration-mock'),'1','Only the isolated Mock server is allowed');
 const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;
}
(async()=>{
 const settings=await call('/api/assistant/settings');
 assert.equal(settings.now,'2026-11-16T15:00:00+08:00');
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const errors=[];
 try{
  for(const generic of [false,true]){
   const page=await browser.newPage({viewport:{width:1440,height:1050},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
   page.on('pageerror',error=>errors.push(error.message));
   await page.goto(web);
   if(generic){
    const session=await call('/api/assistant/sessions','POST',{});
    const proposal=await call(`/api/assistant/sessions/${session.id}/messages`,'POST',{
     client_message_id:crypto.randomUUID(),text:'匿名实时预览验收',actions:[{op:'add',fields:{
      title:'通用草案预览',duration_minutes:30,deadline:'2026-11-16T23:00:00+08:00',
      profile:{fixed_start:'2026-11-16T19:30:00+08:00'},
     }}],
    });
    assert.equal(proposal.status,'ready');
    await page.evaluate(async({workspace,id})=>{
     const {editKey,writeEdit}=await import('/src/workbench.js');
     writeEdit(sessionStorage,editKey(workspace,'shared-draft-selection'),'draft-selection-v1',{
      draftResource:{kind:'planning',id,page:'schedule'},
     });
    },{workspace:settings.workspace_id,id:proposal.id});
    await page.reload();
   }else{
    await page.locator('textarea').first().fill('我今天晚上十九点半到二十点进行升旗仪式，帮我安排在日程里');
    await page.getByRole('button',{name:'发送',exact:true}).click();
   }
   const editor=page.getByRole('region',{name:'共享草案编辑器'});
   await expect(editor).toHaveAttribute('data-status','ready',{timeout:20000});
   const blocks=page.locator('[aria-label="侧栏日历"] .dayflow-canvas [data-event-id^="draft-preview:"]:not(.df-right-panel-event-card)');
   await expect(blocks).toHaveCount(1);
   const writes=[];page.on('request',request=>{
    if(request.url().includes('/api/')&&!['GET','OPTIONS'].includes(request.method()))writes.push(request.url());
   });
   const measure=()=>blocks.evaluateAll(nodes=>nodes.map(node=>({top:node.style.top,height:node.style.height,text:node.textContent})));
   const scroll=()=>page.locator('[aria-label="侧栏日历"] .df-calendar-content').evaluate(node=>node.scrollTop);
   async function input(label,value){
    const field=editor.getByLabel(label,{exact:true});await field.focus();
    await field.evaluate((node,value)=>{
     Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);
     node.dispatchEvent(new Event('input',{bubbles:true}));
    },value);
    await expect(field).toBeFocused();await expect(field).toHaveValue(value);
   }
   async function changes(label,value){
    const previous=await measure();await input(label,value);
    await expect.poll(async()=>JSON.stringify(await measure())).not.toBe(JSON.stringify(previous));
   }
   // A future proposal becomes a past preview before any save/recalculation.
   await changes('开始时间','2026-11-16T07:30');await expect(blocks).toHaveCount(1);
   for(const end of ['09:00','08:30','08:00'])await changes('结束时间',`2026-11-16T${end}`);
   for(const minutes of ['45','60','30'])await changes('预计分钟',minutes);
   for(const start of ['07:00','07:15','07:30']){
    const before=await scroll();await changes('开始时间',`2026-11-16T${start}`);
    assert.equal(await scroll(),before,'Small edits must not recenter the calendar');
   }
   await input('结束时间','');await expect(blocks).toHaveCount(0);
   await input('结束时间','2026-11-16T08:30');await expect(blocks).toHaveCount(1);
   assert.deepEqual(writes,[],'Every local edit must preview without saving');
   console.log(`PASS ${generic?'generic':'schedule'}: start/end/minutes, past interval, stable viewport, focused input, clear/restore`);

   // Save an editable future draft, then reopen the same card after reload.
   await input('开始时间','2026-11-16T18:30');
   await input('结束时间','2026-11-16T19:30');
   await editor.getByRole('button',{name:'保存草案编辑',exact:true}).click();
   await expect(editor.getByRole('button',{name:'保存草案编辑',exact:true})).toBeDisabled();
   await page.reload();
   await expect(editor.getByLabel('开始时间',{exact:true})).toHaveValue('2026-11-16T18:30');
   await expect(blocks).toHaveCount(1);
   await changes('结束时间','2026-11-16T20:00');
   // The split operation calculates segment layout, but still writes no facts.
   await editor.getByLabel('允许分段',{exact:true}).check();
   await editor.getByRole('button',{name:'分段',exact:true}).click();
   await expect(blocks).toHaveCount(2);
   const baseline=writes.length;
   for(const [label,value] of [['开始时间1','18:35'],['结束时间1','19:10'],['开始时间2','19:20'],['结束时间2','19:55']]){
    await changes(label,`2026-11-16T${value}`);
    await expect(blocks).toHaveCount(2);
   }
   await input('结束时间1','');await expect(blocks).toHaveCount(1);
   await input('结束时间1','2026-11-16T19:10');await expect(blocks).toHaveCount(2);
   assert.equal(writes.length,baseline,'Segment inputs must not save or confirm');
   assert.ok(writes.every(url=>!url.endsWith('/confirm')&&!url.endsWith('/api/calendar/changes')));
   assert.deepEqual(await call('/api/tasks'),[]);
   const calendar=await call('/api/calendar/events?start=2026-11-16&end=2026-11-17');
   assert.equal(calendar.events.length,0);
   console.log(`PASS ${generic?'generic':'schedule'}: reopen draft, both segment starts/ends, no formal records`);
   await page.close();
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
