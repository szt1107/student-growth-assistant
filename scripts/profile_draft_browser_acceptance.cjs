// Home-chat profile flow against a disposable Mock server, without paid AI.
const runtime=process.env.SGA_PLAYWRIGHT_PATH||'playwright';
const {chromium}=require(runtime),{expect}=require(runtime+'/test');
const assert=require('node:assert/strict');
const api=process.env.SGA_TEST_API||'http://127.0.0.1:8029';
const web=process.env.SGA_TEST_WEB||'http://127.0.0.1:5187';
async function call(path){
  const response=await fetch(api+path);
  assert.equal(response.headers.get('x-sga-integration-mock'),'1');
  assert.ok(response.ok);return response.json();
}
(async()=>{
  const baseline=(await call('/api/assistant/preference-rules')).rules;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1050},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(web);
    await page.getByRole('button',{name:'新对话',exact:true}).click();
    await page.getByRole('button',{name:'添加聊天模式',exact:true}).click();
    await page.getByRole('menuitem',{name:'档案',exact:true}).click();
    await expect(page.getByRole('group',{name:'已选择档案模式'})).toBeVisible();
    async function send(text){
      await page.getByRole('textbox',{name:'会话输入',exact:true}).fill(text);
      await page.getByRole('button',{name:'发送',exact:true}).click();
      await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0,{timeout:20000});
      await expect(page.getByRole('textbox',{name:'会话输入',exact:true})).toHaveValue('');
    }
    await send('上午11点健身合适');
    await send('帮我把这个偏好写入档案');
    await send('嗯嗯');
    await expect(page.locator('[data-draft-kind="profile"]')).toHaveCount(0);
    await send('工作日，1h');
    const editor=page.getByRole('region',{name:'共享草案编辑器'});
    await expect(editor).toHaveAttribute('data-status','ready',{timeout:20000});
    await expect(editor.getByLabel('开始时间',{exact:true})).toHaveValue('11:00');
    await expect(editor.getByLabel('结束时间',{exact:true})).toHaveValue('12:00');
    await expect(editor.getByRole('combobox',{name:'适用类别',exact:true})).toHaveValue('draftcat:preference');
    for(const day of ['一','二','三','四','五'])await expect(editor.getByRole('checkbox',{name:`周${day}`,exact:true})).toBeChecked();
    for(const day of ['六','日'])await expect(editor.getByRole('checkbox',{name:`周${day}`,exact:true})).not.toBeChecked();
    assert.deepEqual((await call('/api/assistant/preference-rules')).rules,baseline);
    assert.ok(!(await call('/api/task-categories')).categories.some(row=>row.name==='健身'));
    assert.deepEqual(await call('/api/tasks'),[]);
    const auxiliary=page.getByRole('tablist',{name:'辅助栏页签'});
    await auxiliary.getByRole('tab',{name:'档案',exact:true}).click();
    const preview=page.getByRole('region',{name:'档案修改预览'});
    await expect(preview).toBeVisible();
    await editor.getByLabel('结束时间',{exact:true}).fill('12:30');
    await editor.getByRole('checkbox',{name:'周五',exact:true}).uncheck();
    await expect(preview.getByLabel('结束时间',{exact:true})).toHaveValue('12:30');
    await expect(preview.getByRole('checkbox',{name:'周五',exact:true})).not.toBeChecked();
    await editor.getByLabel('结束时间',{exact:true}).fill('12:00');
    await editor.getByRole('checkbox',{name:'周五',exact:true}).check();
    await editor.getByRole('button',{name:'保存草案编辑',exact:true}).click();
    await expect(editor.getByRole('button',{name:'确认正式保存',exact:true})).toBeEnabled();
    if(process.env.SGA_TEST_ARTIFACTS)await page.screenshot({path:process.env.SGA_TEST_ARTIFACTS+'/profile-chat-draft.png',fullPage:true});
    await editor.getByRole('button',{name:'确认正式保存',exact:true}).click();
    await expect(editor).toHaveAttribute('data-status','applied');
    const saved=await call('/api/assistant/preference-rules');
    const category=saved.categories.find(row=>row.name==='健身');
    const rules=saved.rules.filter(row=>row.category_key===category.key);
    assert.equal(rules.length,1);assert.deepEqual(rules[0].weekdays,[1,2,3,4,5]);
    assert.deepEqual(rules[0].parameters,{start:'11:00',end:'12:00'});
    const nav=page.getByRole('navigation',{name:'主导航'});
    await nav.getByRole('button',{name:'档案',exact:true}).click();
    await page.getByRole('tab',{name:'安排偏好',exact:true}).click();
    const card=page.locator('.preference-rule-card').filter({hasText:'健身时间偏好'});
    await expect(card).toContainText('11:00');await expect(card).toContainText('12:00');
    await page.reload();await expect(card).toBeVisible();
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    console.log('PASS home profile mode; contextual draft creation; category/weekdays/time editing; synchronized preview; no formal writes before confirmation; persisted profile; reload; mobile');
  }catch(error){
    if(process.env.SGA_TEST_ARTIFACTS)await page.screenshot({path:process.env.SGA_TEST_ARTIFACTS+'/profile-chat-failure.png',fullPage:true});
    throw error;
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
