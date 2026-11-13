import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/codex/theme.css'
import TaskForm from '../../src/components/TaskForm.jsx'
import CalendarEditor from '../../src/codex/CalendarEditor.jsx'
import { ConfirmationProvider, useConfirmation } from '../../src/codex/ui/confirmation-provider.jsx'
import { ConfirmAction } from '../../src/codex/ui/confirm-action.jsx'
import { Button } from '../../src/codex/ui/button.jsx'
import { ConversationRow } from '../../src/codex/ConversationActions.jsx'
window.uiChecks = { taskSubmits: [], confirmations: 0, closes: 0 }
function Harness() {
 const confirm = useConfirmation(), [calendar,setCalendar] = useState(false),[result,setResult] = useState('尚未确认'), [menu,setMenu]=useState(false)
 return <main style={{padding:24,maxWidth:700,margin:'auto'}}><h1>控件行为验收</h1>
  <TaskForm task={{title:'匿名测试任务',duration_minutes:30,deadline:'2026-11-02T10:00:00+08:00',priority:'normal'}} onSubmit={async value=>{window.uiChecks.taskSubmits.push(value);return true}} onCancel={()=>{window.uiChecks.closes++}} />
  <Button type="button" onClick={async()=>setResult(await confirm('替换本地编辑内容？')?'已确认':'已取消')}>测试确认</Button><p role="status">{result}</p>
  <ConfirmAction title="执行一次操作" description="验证异步处理中不能重复确认。" trigger={<Button type="button">异步操作</Button>} onConfirm={async()=>{window.uiChecks.confirmations++;await new Promise(resolve=>window.releaseConfirmation=resolve)}} />
  <Button type="button" onClick={()=>setCalendar(true)}>打开日历编辑</Button>
  <ConversationRow row={{id:1,title:'匿名会话'}} selected expanded={menu} onOpen={()=>{}} onMenu={()=>setMenu(true)} onClose={()=>setMenu(false)} items={[{key:'rename',label:'重命名',select:()=>setResult('已选择改名')},{key:'archive',label:'归档会话',select:()=>setResult('已选择归档')}]} />
  {calendar&&<CalendarEditor initial={{title:'匿名日历事项',start:'2026-11-02T09:00',end:'2026-11-02T10:00',all_day:false,blocks_time:true,description:''}} revision={1} source={{kind:'personal',task_id:7}} onClose={()=>{setCalendar(false);window.uiChecks.closes++}} onOpenTask={()=>{window.uiChecks.taskNavigation=true}} onSaved={()=>{window.uiChecks.calendarSaved=true}}/>}
 </main>
}
createRoot(document.getElementById('ui-harness')).render(<ConfirmationProvider><Harness/></ConfirmationProvider>)
