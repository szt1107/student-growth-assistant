import {useEffect,useRef} from 'react'
import {toolNotices} from '../workbench.js'

const phaseLabels={understanding:'正在理解需求',querying:'正在查询任务与日程',calculating:'正在检查空档并安排时间',generating:'正在整理回复',retrying:'连接暂时不稳定，正在重试'}

export default function ConversationProgress({content={},run,children}){
 const element=useRef(null)
 const status=run?.status||content.status, running=status==='running'
 const expanded=running||['failed','cancelled','interrupted'].includes(status)
 useEffect(()=>{if(element.current)element.current.open=expanded},[expanded,content.run_id,content.attempt])
 const steps=content.progress||[]
 const tools=content.tools||[]
 const drafts=tools.filter(result=>result.draft&&!result.error).map(result=>result.draft)
 const label=running?(phaseLabels[run?.phase]||steps.at(-1)?.label||'正在理解需求')
  :drafts.length?'草案已生成':status==='completed'?'处理已完成':status==='cancelled'?'已停止处理':'处理未完成'
 const notes=[...toolNotices(tools,content.questions),...drafts.flatMap(draft=>[...(draft.schedule_adjustments||[]),...(draft.notices||[])])]
 if(tools.some(result=>result.fallback))notes.push('模型未完成本轮规划，已使用用户信息和默认值生成初稿；默认值可在草案中调整。')
 return <details ref={element} className="conversation-progress" open={expanded} aria-label="处理进度">
  <summary><span role="status" aria-live="polite">{label}</span><span className="progress-toggle">查看过程</span></summary>
  <div className="conversation-progress-body">
   {steps.length>0&&<ol>{steps.map((step,index)=><li key={index} data-state={step.status}>{step.label}{step.status==='running'&&running?'…':''}</li>)}</ol>}
   {[...new Set(notes)].map(note=><p key={note}>{note}</p>)}
   {!steps.length&&!notes.length&&<p>正在结合你的描述整理信息。</p>}
   {children}
  </div>
 </details>
}
