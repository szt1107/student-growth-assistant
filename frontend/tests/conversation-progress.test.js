import test from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {loadJsx} from './codex/load-jsx.js'
const {default:Progress}=await loadJsx(new URL('../src/components/ConversationProgress.jsx',import.meta.url))

test('real processing stages appear before completion and successful drafts default to collapsed',()=>{
 const content={run_id:1,status:'running',progress:[{phase:'calculating',label:'正在检查空档并安排时间',status:'running'}]}
 const active=renderToStaticMarkup(createElement(Progress,{content,run:{phase:'calculating',status:'running'}}))
 assert.match(active,/<details[^>]*open/)
 assert.match(active,/正在检查空档并安排时间/)
 const done=renderToStaticMarkup(createElement(Progress,{content:{...content,status:'completed',tools:[{
  fallback:'trusted_defaults',draft:{schedule_adjustments:['已避开操作系统作业'],notices:[]},
 }]}}))
 assert.doesNotMatch(done,/<details[^>]*open/)
 assert.match(done,/草案已生成/)
 assert.match(done,/默认值/)
 assert.match(done,/已避开操作系统作业/)
})

test('failed or stopped processing keeps recovery actions expanded',()=>{
 for(const status of ['failed','cancelled','interrupted']){
  const html=renderToStaticMarkup(createElement(Progress,{content:{status}},createElement('button',null,'重试回复')))
  assert.match(html,/<details[^>]*open/)
  assert.match(html,/重试回复/)
 }
})
