// Isolated audit: exact user scenario, real progress states, no paid providers.
const runtime=process.env.SGA_PLAYWRIGHT_PATH||'playwright';
const {chromium}=require(runtime),{expect}=require(runtime+'/test');
const assert=require('node:assert/strict');
const api=process.env.SGA_TEST_API||'http://127.0.0.1:8029';
const web=process.env.SGA_TEST_WEB||'http://127.0.0.1:5187';
async function call(path,method='GET',body){
 const response=await fetch(api+path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 assert.equal(response.headers.get('x-sga-integration-mock'),'1');
 const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;
}
(async()=>{
 assert.equal((await call('/api/assistant/settings')).now,'2026-11-16T15:00:00+08:00');
 await call('/api/time-rules','POST',{title:'操作系统作业',kind:'protected',recurrence:'once',date:'2026-11-16',start_time:'19:00',end_time:'20:30'});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1050},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(web);
  await page.locator('textarea').first().fill('草案审计：晚上我还想写一下软件工程演讲稿，预计1个小时左右，请你帮我安排');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  const progress=page.locator('.conversation-progress').last();
  await expect(progress).toBeVisible();await expect(progress).toHaveAttribute('open','');
  await expect(progress).toContainText('正在理解需求');
  const editor=page.getByRole('region',{name:'共享草案编辑器'});
  await expect(editor.getByLabel('开始时间',{exact:true})).toHaveValue('2026-11-16T20:30',{timeout:20000});
  await expect(editor.getByLabel('结束时间',{exact:true})).toHaveValue('2026-11-16T21:30');
  await expect(editor.getByLabel('名称',{exact:true})).toHaveValue('软件工程演讲稿');
  await expect(editor.getByLabel('预计分钟',{exact:true})).toHaveValue('60');
  await expect(progress).not.toHaveAttribute('open','');
  await expect(progress.locator('summary')).toContainText('草案已生成');
  const assistant=progress.locator('..');
  assert.ok(await assistant.evaluate(node=>node.querySelector('.conversation-progress').compareDocumentPosition(node.querySelector('.safe-message'))&Node.DOCUMENT_POSITION_FOLLOWING));
  assert.ok(!(await assistant.locator(':scope > .safe-message').innerText()).includes('模型处理未完成'));
  await progress.locator('summary').click();await expect(progress).toHaveAttribute('open','');
  await expect(progress).toContainText('正在查询任务与日程');
  await expect(progress).toContainText('正在检查空档并安排时间');
  await expect(progress).toContainText('20:30');
  await progress.locator('summary').click();
  if(process.env.SGA_TEST_ARTIFACTS)await page.screenshot({path:process.env.SGA_TEST_ARTIFACTS+'/autodraft-avoids-and-collapses.png',fullPage:true});
  await page.reload();
  await expect(page.locator('.conversation-progress').last()).not.toHaveAttribute('open','');
  await page.locator('.conversation-progress summary').last().click();
  await expect(page.locator('.conversation-progress').last()).toContainText('正在检查空档并安排时间');
  assert.deepEqual(await call('/api/tasks'),[]);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log('PASS 20:30–21:30 automatic avoidance; live real stages above reply; automatic collapse and manual reopen; reload persistence; mobile; no formal writes');
 }catch(e){if(process.env.SGA_TEST_ARTIFACTS)await page.screenshot({path:process.env.SGA_TEST_ARTIFACTS+'/autodraft-failure.png',fullPage:true});throw e}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
