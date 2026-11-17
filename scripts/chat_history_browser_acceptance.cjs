// History regression checks use a fresh integration_demo.py database only.
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
 const settings=await call('/api/assistant/settings');
 const first=await call('/api/conversations','POST',{client_request_id:crypto.randomUUID(),title:'长对话历史验收'});
 const second=await call('/api/conversations','POST',{client_request_id:crypto.randomUUID(),title:'第二个独立会话'});
 for(let index=1;index<=145;index++)await call(`/api/conversations/${first.id}/messages`,'POST',{
  client_message_id:crypto.randomUUID(),text:`历史记录第${index}条。`+'保留原始聊天内容，检查消息分页和刷新恢复。'.repeat(3),
 });
 await call(`/api/conversations/${second.id}/messages`,'POST',{client_message_id:crypto.randomUUID(),text:'第二个会话的独立内容'});
 const run=await call(`/api/conversations/${first.id}/runs`,'POST',{
  client_message_id:crypto.randomUUID(),text:'今晚帮我安排阅读，预计30分钟',
 });
 let result=run;
 for(let attempt=0;attempt<100&&result.status==='running';attempt++){
  await new Promise(resolve=>setTimeout(resolve,100));result=await call(`/api/conversations/${first.id}/runs/${run.id}`);
 }
 assert.equal(result.status,'completed');
 const internal=result.content.tools.find(tool=>tool.draft)?.draft.session_id;
 assert.ok(internal);
 const actual=(await call(`/api/conversations/${first.id}/messages?limit=100`)).items;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1050},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(web);
  const row=id=>page.locator(`[data-conversation-id="${id}"] .conversation-title`);
  await expect(row(first.id)).toBeVisible();await expect(row(internal)).toHaveCount(0);
  await row(first.id).click();
  const chat=page.getByRole('region',{name:'持久会话'});
  const articles=chat.locator('.chat-scroll > article[id]');
  await expect(articles).toHaveCount(30);
  for(let attempt=0;attempt<6;attempt++){
   const earlier=chat.getByRole('button',{name:'加载更早消息',exact:true});
   if(await earlier.count()===0)break;
   const response=page.waitForResponse(response=>response.url().includes('/messages?before_id=')&&response.status()===200);
   await earlier.click();await response;
   await expect(earlier).toBeEnabled().catch(()=>{});
  }
  const oldest=`#conversation-message-${first.id}-${actual[0].id}`;
  await expect(page.locator(oldest)).toContainText('历史记录第1条');
  assert.ok(await articles.count()<=120);
  await page.getByRole('button',{name:'刷新列表',exact:true}).click();
  await expect(page.locator(oldest)).toBeVisible();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'日程',exact:true}).click();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'首页',exact:true}).click();
  await expect(page.locator(oldest)).toBeVisible();
  console.log('PASS 147 persisted messages remain reachable; 120 DOM limit; refresh and navigation retain loaded history');

  await page.locator(oldest).scrollIntoViewIfNeeded();
  await chat.locator('.chat-scroll').evaluate(node=>node.dispatchEvent(new Event('scroll',{bubbles:true})));
  await page.reload();
  await expect(page.locator(oldest)).toBeVisible();
  await expect(chat.getByRole('button',{name:'加载后续消息',exact:true})).toBeVisible();
  await row(second.id).click();await expect(chat).toContainText('第二个会话的独立内容');
  await expect(chat).not.toContainText('历史记录第1条');
  await row(first.id).click();await expect(page.locator(oldest)).toBeVisible();
  console.log('PASS old scroll position survives reload and switching conversations');

  let release;
  const delayed=new Promise(resolve=>{release=resolve});
  await page.route(`**/api/conversations/${second.id}/messages?*`,async route=>{await delayed;await route.continue()});
  await row(second.id).click();await row(first.id).click();release();
  await expect(page.locator(oldest)).toBeVisible();
  await expect(chat).not.toContainText('第二个会话的独立内容');
  await page.unroute(`**/api/conversations/${second.id}/messages?*`);
  console.log('PASS late responses cannot replace another conversation');

  // Reproduce the persisted sidebar selection visible in the user screenshot.
  await page.evaluate(async({workspace,internal})=>{
   const {editKey,writeEdit}=await import('/src/workbench.js');
   writeEdit(sessionStorage,editKey(workspace,'selection'),null,internal);
  },{workspace:settings.workspace_id,internal});
  await page.reload();
  await expect(row(first.id)).toHaveAttribute('aria-current','true');
  await expect(chat.getByRole('textbox',{name:'会话输入',exact:true})).toBeEnabled();
  await expect(page.locator(oldest)).toBeVisible();
  console.log('PASS cached internal business session redirects to its original chat');

  await page.evaluate(({workspace,id})=>sessionStorage.setItem(`sga-chat-scroll:${workspace}:${id}`,JSON.stringify({top:0,first_id:99999999})),{workspace:settings.workspace_id,id:first.id});
  await page.reload();await expect(articles).toHaveCount(30);
  await expect(chat.getByRole('button',{name:'加载更早消息',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log('PASS stale scroll cache falls back to real messages; mobile layout; zero browser errors');
 }catch(error){if(process.env.SGA_TEST_ARTIFACTS)await page.screenshot({path:process.env.SGA_TEST_ARTIFACTS+'/chat-history-failure.png',fullPage:true});throw error}finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
