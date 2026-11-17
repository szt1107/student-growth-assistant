// Real account/session flows over disposable Mock workspaces. No paid AI.
const runtime=process.env.SGA_PLAYWRIGHT_PATH||'playwright';
const {chromium}=require(runtime),{expect}=require(runtime+'/test');
const assert=require('node:assert/strict');
const api=process.env.SGA_TEST_API||'http://127.0.0.1:8029';
const web=process.env.SGA_TEST_WEB||'http://127.0.0.1:5187';
const nonce=Date.now().toString(36);
const alice='qa-alice-'+nonce,bob='qa-bob-'+nonce,password='Qa-test-only-123';

(async()=>{
  const marker=await fetch(api+'/api/health');
  assert.equal(marker.headers.get('x-sga-integration-mock'),'1');
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:960},locale:'zh-CN'});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  async function call(path,method='GET',body){
    const response=await context.request.fetch(api+path,{method,data:body});
    assert.ok(response.ok(),await response.text());
    return response.json();
  }
  async function register(name){
    await page.getByRole('link',{name:'注册账号',exact:true}).click();
    await page.getByRole('textbox',{name:'账号',exact:true}).fill(name);
    await page.getByLabel('密码',{exact:true}).fill(password);
    await page.getByLabel('确认密码',{exact:true}).fill(password);
    await page.getByRole('button',{name:'注册',exact:true}).click();
    await expect(page.getByRole('navigation',{name:'主导航'})).toBeVisible({timeout:20000});
  }
  async function login(name,secret=password){
    await page.getByRole('textbox',{name:'账号',exact:true}).fill(name);
    await page.getByLabel('密码',{exact:true}).fill(secret);
    await page.getByRole('button',{name:'登录',exact:true}).click();
  }
  async function send(text){
    await page.getByRole('textbox',{name:'会话输入',exact:true}).fill(text);
    await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0,{timeout:20000});
    await expect(page.getByRole('textbox',{name:'会话输入',exact:true})).toHaveValue('');
  }
  try{
    await page.goto(web);
    await expect(page).toHaveURL(web+'/login');
    await register(alice);
    assert.equal((await call('/api/auth/session')).user.account,alice);
    const aliceSettings=await call('/api/assistant/settings');
    await send('QA账号A的聊天记录');
    const conversations=await call('/api/conversations');
    assert.equal(conversations.items.length,1);
    const sid=conversations.items[0].id;
    await send('工作日上午11点健身，每次1h，帮我写入档案');
    await expect(page.getByRole('region',{name:'共享草案编辑器'})).toHaveAttribute('data-status','ready',{timeout:20000});
    const calendar=await call('/api/calendar/events?start=2026-11-16&end=2026-11-17');
    await call('/api/calendar/changes','POST',{action:'save',title:'Alice 的私人日程',
      start:'2026-11-16T19:00:00+08:00',end:'2026-11-16T20:00:00+08:00',
      all_day:false,blocks_time:true,expected_revision:calendar.revision,client_request_id:'qa-calendar-'+nonce});
    await call('/api/goals','POST',{title:'Alice 的私人目标',metric_kind:'count',weekly_target:2});
    await call('/api/assistant/preference-rules','POST',{name:'Alice 的私人偏好',kind:'prefer_time',
      category_key:'reading',weekdays:[1,2,3,4,5],parameters:{start:'11:00',end:'12:00'}});
    await page.getByRole('button',{name:'注销',exact:true}).click();
    await expect(page).toHaveURL(web+'/login');
    assert.equal((await context.request.get(api+'/api/tasks')).status(),401);
    await login(alice,'wrong-password');
    await expect(page.getByRole('alert')).toContainText('账号或密码不正确');
    await page.getByRole('checkbox',{name:'记住账号'}).check();
    await login(alice);
    await expect(page.getByRole('navigation',{name:'主导航'})).toBeVisible();
    assert.equal((await call('/api/assistant/settings')).workspace_id,aliceSettings.workspace_id);
    assert.ok((await call('/api/calendar/events?start=2026-11-16&end=2026-11-17')).events.some(event=>event.title==='Alice 的私人日程'));
    await page.reload();
    await expect(page.getByRole('button',{name:'注销',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'注销',exact:true}).click();
    await expect(page).toHaveURL(web+'/login');
    await register(bob);
    assert.equal((await call('/api/auth/session')).user.account,bob);
    assert.notEqual((await call('/api/assistant/settings')).workspace_id,aliceSettings.workspace_id);
    assert.deepEqual((await call('/api/conversations')).items,[]);
    assert.equal((await context.request.get(api+`/api/conversations/${sid}`)).status(),404);
    assert.deepEqual((await call('/api/calendar/events?start=2026-11-16&end=2026-11-17')).events,[]);
    const snapshot=await call('/api/data/export');
    assert.deepEqual(snapshot.tables.growth_goals,[]);
    assert.ok(!snapshot.tables.preference_rules.some(rule=>rule.name==='Alice 的私人偏好'));
    assert.ok(!('accounts' in snapshot.tables));
    await send('QA账号B的聊天记录');
    assert.equal((await call('/api/conversations')).items[0].id,sid);
    await page.getByRole('button',{name:'注销',exact:true}).click();
    await expect(page).toHaveURL(web+'/login');
    await page.setViewportSize({width:390,height:844});
    await login(alice);
    await expect(page.getByRole('button',{name:'注销',exact:true})).toBeVisible();
    const privateMessages=await call(`/api/conversations/${sid}/messages?latest=true`);
    assert.ok(privateMessages.items.some(message=>message.text==='QA账号A的聊天记录'));
    assert.ok(!privateMessages.items.some(message=>message.text==='QA账号B的聊天记录'));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(process.env.SGA_TEST_ARTIFACTS)await page.screenshot({path:process.env.SGA_TEST_ARTIFACTS+'/authenticated-workspace-mobile.png',fullPage:true});
    await page.getByRole('button',{name:'注销',exact:true}).click();
    await expect(page).toHaveURL(web+'/login');
    assert.deepEqual(errors,[]);
    console.log('PASS real UI registration, automatic sign-in, invalid-password recovery, session persistence, server logout, protected entry, two independent accounts, overlapping record IDs, chat/calendar/goals/preferences/draft/export isolation, mobile');
  }catch(error){
    if(process.env.SGA_TEST_ARTIFACTS)await page.screenshot({path:process.env.SGA_TEST_ARTIFACTS+'/auth-acceptance-failure.png',fullPage:true});
    throw error;
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
