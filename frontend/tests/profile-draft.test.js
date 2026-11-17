import test from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {loadJsx} from './codex/load-jsx.js'
const {DraftPreview}=await loadJsx(new URL('../src/components/WorkspaceDraft.jsx',import.meta.url))

test('profile preview displays category, weekdays and time window',()=>{
  const draft={kind:'profile',task_categories:[{key:'reading',name:'阅读',active:true}],content:{operations:[
    {op:'create_category',name:'健身',temp_ref:'draftcat:fitness'},
    {op:'create_preference_rule',name:'健身时间偏好',kind:'prefer_time',category_ref:'draftcat:fitness',weekdays:[1,2,3,4,5],parameters:{start:'11:00',end:'12:00'}},
  ]}}
  const html=renderToStaticMarkup(createElement(DraftPreview,{draft}))
  assert.match(html,/健身（新增）/)
  assert.match(html,/适用星期/)
  assert.equal((html.match(/checked=""/g)||[]).length,5)
  assert.match(html,/优先安排时段/)
  assert.match(html,/type="time"[^>]*value="11:00"/)
  assert.match(html,/type="time"[^>]*value="12:00"/)
  assert.match(html,/<option value="draftcat:fitness" selected="">健身（新增）/)
})
