// Anonymous acceptance for message alignment, review tabs, and calendar selection.
// Refuses the real backend; run integration_demo.py with the same clock first.
const runtime=process.env.SGA_PLAYWRIGHT_PATH || 'playwright';
const {chromium}=require(runtime),{expect}=require(runtime+'/test');
const assert=require('node:assert/strict');
const api=process.env.SGA_TEST_API || 'http://127.0.0.1:8029';
const web=process.env.SGA_TEST_WEB || 'http://127.0.0.1:5187';
async function call(path,method='GET',body){
 const response=await fetch(api+path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 assert.equal(response.headers.get('x-sga-integration-mock'),'1','Only isolated Mock data is allowed');
 const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;
}
(async()=>{
 assert.equal((await call('/api/assistant/settings')).now,'2026-11-16T15:00:00+08:00');
 const conversation=await call('/api/conversations','POST',{client_request_id:crypto.randomUUID(),title:'提示位置验收'});
 for(let i=0;i<14;i++)await call(`/api/conversations/${conversation.id}/messages`,'POST',{
  client_message_id:crypto.randomUUID(),text:`第${i+1}条历史消息。`+'用于检查消息区域滚动及新回复提示。'.repeat(28),
 });
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1480,height:950},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
 const errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>calls.push(r.url()));
 try{
  await page.goto(web);
  await page.locator(`[data-conversation-id="${conversation.id}"] .conversation-title`).click();
  const chat=page.getByRole('region',{name:'持久会话'}),history=chat.locator('.chat-scroll');
  await expect(chat.locator('article')).toHaveCount(14);
  await history.evaluate(node=>{node.scrollTop=0;node.dispatchEvent(new Event('scroll',{bubbles:true}))});
  await call(`/api/conversations/${conversation.id}/messages`,'POST',{client_message_id:crypto.randomUUID(),text:'用于显示有新回复的新增消息'});
  await page.getByRole('button',{name:'刷新列表',exact:true}).click();
  const unread=chat.getByRole('button',{name:'有新回复',exact:true});await expect(unread).toBeVisible();
  async function checkAlignment(){
   const a=await unread.boundingBox(),b=await chat.locator('.aui-send').boundingBox();
   assert.ok(Math.abs(a.x+a.width/2-b.x-b.width/2)<=12,'Unread prompt aligns above send/stop');
   assert.ok(a.y+a.height<=b.y,'Unread prompt stays above the composer actions');
   assert.ok(a.x>=0&&a.x+a.width<=(await page.viewportSize()).width,'Prompt remains in viewport');
  }
  await checkAlignment();
  await page.getByRole('button',{name:'展开右侧栏',exact:true}).click();await checkAlignment();
  await page.getByRole('button',{name:'收起会话列表',exact:true}).click();await checkAlignment();
  console.log('PASS unread aligns with composer with side panel and conversation list toggled');
  if(process.env.SGA_TEST_ARTIFACTS)await page.screenshot({path:process.env.SGA_TEST_ARTIFACTS+'/unread-aligned-desktop.png'});
  await unread.click();await expect(unread).toHaveCount(0);

  const nav=page.getByRole('navigation',{name:'主导航'});
  await nav.getByRole('button',{name:'复盘',exact:true}).click();
  for(const tab of ['回顾','成长趋势','复盘记录']){
   await page.getByRole('tab',{name:tab,exact:true}).click();
   await expect(page.getByText('AI 周复盘与习惯建议',{exact:true})).toHaveCount(0);
   if(tab==='成长趋势')await expect(page.getByRole('region',{name:'成长统计概览'})).toBeVisible();
   if(tab==='复盘记录')await expect(page.getByRole('search',{name:'筛选复盘记录'})).toBeVisible();
  }
  assert.ok(!calls.some(url=>/\/api\/(review\/context|growth\/(reviews|insights))/.test(url)));
  console.log('PASS removed AI module; review records and growth statistics still work');

  await nav.getByRole('button',{name:'日程',exact:true}).click();
  const surface=page.getByRole('region',{name:'完整日历'});
  await expect(surface.locator('.dayflow-canvas')).toHaveAttribute('aria-busy','false');
  const selection=surface.locator('[data-event-id="calendar-selection:pending"]:not(.df-right-panel-event-card)');
  const editor=page.locator('[data-calendar-editor="anchored"]');
  async function drag(){
   const cell=await surface.locator('.df-week-time-grid-cell').first().boundingBox();
   const region=await surface.locator('.df-calendar-content').boundingBox();
   const x=cell.x+cell.width/2,y=region.y+144;
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+108,{steps:15});await page.mouse.up();
   await expect(editor).toBeVisible();await expect(selection).toHaveCount(1);await expect(selection).toBeVisible();
  }
  await drag();
  const initial=await selection.boundingBox();
  const end=await editor.getByLabel('结束',{exact:true}).inputValue();
  const later=end.slice(0,11)+String(Number(end.slice(11,13))+1).padStart(2,'0')+end.slice(13);
  await editor.getByLabel('结束',{exact:true}).fill(later);
  await expect.poll(async()=>(await selection.boundingBox()).height).toBeGreaterThan(initial.height);
  await editor.getByLabel('事项名称',{exact:true}).fill('未保存时间块');await expect(selection).toContainText('未保存时间块');
  assert.equal((await call('/api/calendar/events?start=2026-11-16&end=2026-11-17')).events.length,0);
  if(process.env.SGA_TEST_ARTIFACTS)await page.screenshot({path:process.env.SGA_TEST_ARTIFACTS+'/selection-editor-desktop.png'});
  await editor.getByRole('button',{name:'取消',exact:true}).click();await expect(selection).toHaveCount(0);
  await drag();await editor.getByRole('button',{name:'关闭日程编辑',exact:true}).click();await expect(selection).toHaveCount(0);
  await drag();await page.keyboard.press('Escape');await expect(selection).toHaveCount(0);
  await drag();await editor.getByLabel('事项名称',{exact:true}).fill('选择保留验收');
  await editor.getByRole('button',{name:'保存日程',exact:true}).click();await expect(editor).toHaveCount(0);await expect(selection).toHaveCount(0);
  await expect(surface.locator('[data-event-id^="calendar:"]:not(.df-right-panel-event-card)')).toHaveCount(1);
  assert.equal((await call('/api/calendar/events?start=2026-11-16&end=2026-11-17')).events.length,1);
  console.log('PASS real drag selection stays green through edits; cancel/close/Escape/save remove temporary block');

  await page.setViewportSize({width:390,height:844});
  await nav.getByRole('button',{name:'复盘',exact:true}).click();
  await expect(page.getByText('AI 周复盘与习惯建议',{exact:true})).toHaveCount(0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);console.log('PASS mobile layout and zero browser errors');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
