import { Alert, Button } from '../codex/ui/controls.js'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getReviewFacts, getTasks } from '../api.js'
import ReviewWorkspace from '../components/ReviewWorkspace.jsx'
import GrowthAnalytics from '../components/GrowthAnalytics.jsx'
import '../analytics.css'
import { reviewRange } from '../calendar.js'

export default function ReviewPage({ active = true, refreshVersion = 0, auxiliaryTarget = null, onDataChanged, onReturnChat, workspace, today, onDiscuss, resource, onOpenTask, primaryActive=active, clockMode='realtime' }) {
  const [statisticsMounted,setStatisticsMounted]=useState(false)
  const [parentTasks,setParentTasks]=useState([])
  const [overview,setOverview]=useState(null)
  const [auxFacts,setAuxFacts]=useState(null)
  const [overviewError,setOverviewError]=useState('')
  const [error,setError]=useState('')

  useEffect(()=>{
    if(!auxiliaryTarget||!today)return
    let valid=true;const [start,end]=reviewRange(today,'week')
    getReviewFacts(start,end).then(value=>{if(valid){setAuxFacts(value);setOverviewError('')}}).catch(cause=>{if(valid)setOverviewError(cause.message)})
    return()=>{valid=false}
  },[auxiliaryTarget,today,refreshVersion])

  async function refreshParents(){
    try {
      const tasks=await getTasks()
      setParentTasks(tasks.filter(task=>task.task_kind==='container'));setError('')
    }catch(cause){setError(cause.message)}
  }
  useEffect(()=>{if(active&&statisticsMounted)refreshParents()},[active,refreshVersion,statisticsMounted])

  return <><section className="growth-page" aria-label="回顾与成长">
    {onReturnChat&&<Button className="button subtle" onClick={onReturnChat}>返回相关对话</Button>}
    {error&&<Alert variant="destructive" role="alert">{error}</Alert>}
    {today&&<ReviewWorkspace workspace={workspace} today={today} clockMode={clockMode} active={primaryActive} refreshVersion={refreshVersion} onDiscuss={onDiscuss} onSaved={onDataChanged} resource={resource} onOpenTask={onOpenTask} onAnalyticsOpen={()=>setStatisticsMounted(true)} analyticsContent={<GrowthAnalytics active={primaryActive} refreshVersion={refreshVersion} parentTasks={parentTasks} onOverview={setOverview} onOverviewError={setOverviewError} onRefresh={refreshParents}/>}/>}
  </section>
    {auxiliaryTarget&&createPortal(<section className="v2-readonly-summary" aria-label="复盘辅助视图">
      <h3>本周回顾</h3>
      {overviewError&&<p role="status">摘要暂时无法更新{overview?'，以下为上次读取的记录。':'。'}</p>}
      {auxFacts?<><p className="muted">{auxFacts.start_date} 起的一周</p><dl>
        <div><dt>已确认完成</dt><dd>{auxFacts.completed_count} 项</dd></div>
        <div><dt>已记录投入</dt><dd>{`${auxFacts.known_minutes} 分钟${auxFacts.unknown_count?'（另有未知）':''}`}</dd></div>
        <div><dt>有效反馈</dt><dd>{auxFacts.feedback_ids.length} 条</dd></div>
      </dl></>:!overviewError&&<p role="status">正在读取本周记录…</p>}
    </section>,auxiliaryTarget)}
  </>
}
