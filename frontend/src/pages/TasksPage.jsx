import { Alert } from '../codex/ui/controls.js'
import { Button, Input, NativeSelect, Label } from '../codex/ui/controls.js'
import { useEffect, useRef, useState } from 'react'
import { STATUS_LABELS, PRIORITY_LABELS } from '../localization.js'
import {
  getTasksDashboard, createTask, finishWorkSession, getTaskFeedback, pauseWorkSession,
  resumeWorkSession, saveTaskGrowthContext, startWorkSession, submitTaskFeedback,
  updateTask,
} from '../api.js'
import { displayDeadline } from '../datetime.js'
import TaskForm from '../components/TaskForm.jsx'
import TaskHierarchy from '../components/TaskHierarchy.jsx'
import EditRecovery, { useEditRecovery } from '../components/EditRecovery.jsx'

const freshFeedback = { outcome: 'completed', actual_minutes: '', remaining_minutes: '30', family: 'other', difficulty: 'expected', reason: '' }

function timerSeconds(session, now) {
  const base = session?.accumulated_seconds || 0
  return session?.status === 'running' && session.segment_started_at ? base + Math.max(0, Math.floor((now - Date.parse(session.segment_started_at)) / 1000)) : base
}

function formatTimer(total) {
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export default function TasksPage({ onAdjustTask, refreshVersion=0,onDataChanged,recoveryWorkspace,active=true,taskId,onPendingChange }) {
  const [tasks, setTasks] = useState([])
  const [categories, setCategories] = useState([])
  const [contexts, setContexts] = useState({})
  const [sessions, setSessions] = useState({})
  const [feedbackCounts,setFeedbackCounts]=useState({})
  const [feedbacks, setFeedbacks] = useState({})
  const [advice, setAdvice] = useState({})
  const [schedules, setSchedules] = useState({}), [execution, setExecution] = useState({}), [lockedTasks, setLockedTasks] = useState([])
  const [feedbackForms, setFeedbackForms] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [recordingId, setRecordingId] = useState(null)
  const [addingChild, setAddingChild] = useState(null)
  const [pending, setPending] = useState(false)
  const [formVersion, setFormVersion] = useState(0)
  const [tick, setTick] = useState(Date.now())
  const actionIds = useRef({})
  const editVersions = useRef({}), loadSequence = useRef(0), mutation = useRef(false)
  const loaded = useRef(false)

  async function load() {
    const sequence = ++loadSequence.current
    setActionError('')
    if(!loaded.current)setLoading(true)
    setLoadError('')
    try {
      const snapshot=await getTasksDashboard()
      if (sequence !== loadSequence.current) return
      setTasks(snapshot.tasks);setCategories(snapshot.categories);setContexts(snapshot.contexts)
      setSessions(snapshot.sessions);setAdvice(snapshot.advice);setFeedbackCounts(snapshot.feedback_counts)
      setSchedules(snapshot.schedules || {});setExecution(snapshot.execution || {});setLockedTasks(snapshot.locked_task_ids || [])
      setFeedbacks({})
      loaded.current=true
    } catch (error) { if (sequence === loadSequence.current) setLoadError(error.message) }
    finally { if (sequence === loadSequence.current) setLoading(false) }
  }

  useEffect(() => { if(active)load() }, [refreshVersion,active])
  useEffect(() => () => { loadSequence.current++ }, [])
  useEffect(() => { onPendingChange?.(pending) }, [pending,onPendingChange])
  function beginEdit(task) {
    if (editingId === task.id) return
    editVersions.current[task.id] = task.updated_at
    setActionError('');setEditingId(task.id)
  }
  useEffect(() => { const timer = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(timer) }, [])

  async function save(data, id = null) {
    if (mutation.current) return
    mutation.current=true;setPending(true); setActionError('')
    try {
      if (id === null) { await createTask(data); setFormVersion((value) => value + 1) }
      else { await updateTask(id, { ...data, expected_updated_at: editVersions.current[id] }); setEditingId(null) }
      await load();onDataChanged?.();return true
    } catch (error) { setActionError(error.message);return false }
    finally { mutation.current=false;setPending(false) }
  }

  async function setStatus(task, status) {
    if (mutation.current) return
    mutation.current=true
    setPending(true); setActionError('')
    try { await updateTask(task.id, { status }); await load();onDataChanged?.() }
    catch (error) { setActionError(error.message) }
    finally { mutation.current=false;setPending(false) }
  }

  async function convert(task) {
    if (mutation.current) return
    mutation.current=true
    setPending(true); setActionError('')
    try { await updateTask(task.id, { task_kind: 'container' }); await load(); onDataChanged?.() }
    catch (error) { setActionError(error.message) }
    finally { mutation.current=false;setPending(false) }
  }

  function formFor(task) {
    return feedbackForms[task.id] || { ...freshFeedback, family: contexts[task.id]?.family || 'other' }
  }

  async function submitFeedback(task) {
    if (mutation.current) return
    mutation.current=true
    const form = formFor(task)
    const key = `${task.id}:${form.outcome}`
    actionIds.current[key] ||= crypto.randomUUID()
    const payload = { client_action_id: actionIds.current[key], outcome: form.outcome, family: form.family, difficulty: form.difficulty, reason: form.reason || undefined }
    if (form.actual_minutes) payload.actual_minutes = Number(form.actual_minutes)
    if (form.outcome === 'partial') payload.remaining_minutes = Number(form.remaining_minutes)
    setPending(true); setActionError('')
    try { await submitTaskFeedback(task.id, payload); delete actionIds.current[key]; setRecordingId(null); await load();onDataChanged?.() }
    catch (error) { setActionError(error.message) }
    finally { mutation.current=false;setPending(false) }
  }

  async function timerAction(task, action) {
    if (mutation.current) return
    mutation.current=true
    setPending(true); setActionError('')
    try {
      let session = sessions[task.id]
      let result
      if (action === 'start') {
        const key = `timer:${task.id}`
        actionIds.current[key] ||= crypto.randomUUID()
        result = await startWorkSession({ task_id: task.id, client_action_id: actionIds.current[key] })
        delete actionIds.current[key]
      }
      else if (action === 'pause') result = await pauseWorkSession(session.id)
      else if (action === 'resume') result = await resumeWorkSession(session.id)
      else result = await finishWorkSession(session.id)
      if (action === 'finish') {
        if (result.suggested_minutes > 0 && result.suggested_minutes <= 1440) setFeedbackForms((current) => ({ ...current, [task.id]: { ...formFor(task), actual_minutes: String(result.suggested_minutes) } }))
        setRecordingId(task.id)
      }
      await load();onDataChanged?.()
    } catch (error) { setActionError(error.message) }
    finally { mutation.current=false;setPending(false) }
  }

  async function saveFamily(task, value) {
    if (mutation.current) return
    mutation.current=true
    const context = contexts[task.id] || {}
    setPending(true); setActionError('')
    try { await saveTaskGrowthContext(task.id, { family: value, goal_id: context.goal_id || null, deadline_source: context.deadline_source || 'external' }); await load();onDataChanged?.() }
    catch (error) { setActionError(error.message) }
    finally { mutation.current=false;setPending(false) }
  }

  const [showAdd,setShowAdd]=useState(false)
  const recovery=useEditRecovery({workspace:recoveryWorkspace,resource:taskId?`task-detail:${taskId}`:'task-editor-selection',base:loading||loadError?undefined:JSON.stringify(tasks),
    value:{editingId,recordingId,addingChildId:addingChild?.id,feedbackForms,showAdd},dirty:Boolean(editingId||recordingId||addingChild||showAdd),restore:value=>{
      const restoredTask=tasks.find(t=>t.id===value.editingId)
      if(restoredTask)beginEdit(restoredTask)
      else setEditingId(null)
      setRecordingId(tasks.some(t=>t.id===value.recordingId)?value.recordingId:null)
      setAddingChild(tasks.find(t=>t.id===value.addingChildId)||null);setFeedbackForms(value.feedbackForms||{});setShowAdd(Boolean(value.showAdd))
    }})
  const selectedTask = taskId ? tasks.find(task => task.id === taskId) : null
  const shownTasks = taskId ? selectedTask ? tasks.filter(task => task.id === taskId || task.parent_task_id === selectedTask.id) : [] : tasks
  return (
    <section aria-labelledby="tasks-heading" className="task-execution-page"><EditRecovery recovery={recovery} label="任务编辑选择"/>
      <div className="section-heading"><h2 id="tasks-heading">{taskId?'任务与执行情况':'任务与执行记录'}</h2><Button type="button" className="button subtle" disabled={pending||loading||Boolean(editingId)||Boolean(recordingId)} onClick={load}>刷新信息</Button></div>
      {!taskId&&<><Button type="button" className="button secondary" onClick={()=>setShowAdd(v=>!v)}>新增任务</Button><div hidden={!showAdd} className="panel"><h3>新增任务</h3><TaskForm recoveryWorkspace={recoveryWorkspace} key={formVersion} pending={pending} disabled={loading || Boolean(loadError)} onSubmit={(data) => save(data)} /></div></>}
      {actionError && <Alert variant="destructive" role="alert">{actionError}</Alert>}
      {loading ? <p className="state-box" role="status">正在加载任务和执行历史…</p> : loadError ? <div className="error-box" role="alert">无法加载任务。 {loadError} <Button className="button subtle" onClick={load} type="button">重试</Button></div> : !shownTasks.length ? <p className="state-box">{taskId?'这项任务已不存在，请关闭详情并刷新日程。':'暂无任务。'}</p> : <div className="card-list">
        <TaskHierarchy tasks={shownTasks} pending={pending} onEditContainer={task=>{beginEdit(task);setAddingChild(null)}} onAddChild={task=>{setAddingChild(task);setEditingId(null)}} renderContainer={task=><>
          {editingId===task.id && <TaskForm recoveryWorkspace={recoveryWorkspace} key={`parent-${task.id}`} task={task} pending={pending} onSubmit={data=>save(data,task.id)} onCancel={()=>setEditingId(null)} />}
          {addingChild?.id===task.id && <TaskForm recoveryWorkspace={recoveryWorkspace} recoveryResource={`task:child-of-${task.id}`} key={`child-${task.id}-${formVersion}`} pending={pending} onCancel={()=>setAddingChild(null)} onSubmit={data=>save({...data,parent_task_id:task.id,sort_order:tasks.filter(t=>t.parent_task_id===task.id).length})} />}
        </>} renderTask={(task) => {
          const context = contexts[task.id] || {}
          const session = sessions[task.id]
          const taskAdvice = advice[task.id]
          const form = formFor(task)
          const progress = execution[task.id]
          const effort = !progress ? '尚无执行反馈' : progress.actual_minutes
            ? `已记录投入 ${progress.actual_minutes} 分钟${progress.unknown_time_entries?'，另有反馈未记耗时':''}` : '反馈未记录耗时'
          return <article tabIndex={-1} data-resource-task={task.id} className="item-card task-execution-card" key={task.id}>
            <div className="item-top"><div><h4>{task.title}</h4><span className="task-context-label">{context.goal_id ? '已关联成长目标' : '未关联目标'}{context.family_confirmed ? ` · ${categories.find((item) => item.key === context.family)?.name || context.family}` : ' · 类型待确认'}</span></div><span className={`badge status-${task.status}`}>{STATUS_LABELS[task.status]}</span></div>
            {task.description && <p className="description">{task.description}</p>}
            <dl className="details"><div><dt>剩余时长</dt><dd>{task.status==='done'?0:task.duration_minutes} 分钟</dd></div><div><dt>截止时间</dt><dd>{displayDeadline(task.deadline)}</dd></div><div><dt>优先级</dt><dd>{PRIORITY_LABELS[task.priority]}</dd></div><div><dt>类别</dt><dd>{categories.find(item=>item.key===context.family)?.name||'未分类'}</dd></div><div><dt>初始估时</dt><dd>{context.initial_estimate_minutes || task.duration_minutes} 分钟</dd></div><div><dt>执行进度</dt><dd>{task.status==='done'?'已确认完成':progress?.outcome==='partial'?'部分完成':task.status==='cancelled'?'已取消':'待完成'} · {effort}</dd></div></dl>
            {lockedTasks.includes(task.id)&&<p className="helper">安排已锁定，重新排程仍会保留锁定时段。</p>}
            <section className="task-schedule-details" aria-label="已安排时段"><h5>已安排时段 · 北京时间</h5>{schedules[task.id]?.length?<ul>{schedules[task.id].map(item=><li key={item.id}>{displayDeadline(item.start_at)} 至 {displayDeadline(item.end_at)}</li>)}</ul>:<p className="helper">尚无正式安排。</p>}</section>
            <div className="button-row"><Button className="button secondary" type="button" disabled={pending} onClick={()=>beginEdit(task)}>编辑任务</Button><Button className="button secondary" type="button" disabled={pending||task.status!=='todo'} onClick={()=>setRecordingId(recordingId===task.id?null:task.id)}>记录进度</Button><Button className="button subtle" type="button" disabled={pending||task.status!=='todo'} onClick={()=>onAdjustTask?.({taskId:task.id,title:task.title})}>让 AI 重新安排</Button></div>
            {task.status === 'todo' && <>
              <details><summary>分类与学习</summary><div className="task-context-controls"><Label>用于比较同类任务<NativeSelect value={context.family || 'other'} disabled={pending} onChange={(e) => saveFamily(task, e.target.value)}>{categories.filter((item) => item.active || item.key === context.family).map((item) => <option key={item.key} value={item.key}>{item.name}{item.active ? '' : '（已停用）'}</option>)}</NativeSelect></Label><span>只有你确认的类型和实际耗时会进入学习统计。</span></div></details>
              {taskAdvice?.status === 'suggested' && <div className="duration-suggestion"><strong>估时建议：{taskAdvice.current_minutes} → {taskAdvice.suggested_minutes} 分钟</strong><p>来自 {taskAdvice.evidence.sample_count} 条不同任务、{taskAdvice.evidence.active_days} 个日期的有效记录；最多缩短 25%。</p><Button className="button subtle" disabled={pending} onClick={() => onAdjustTask?.({ taskId: task.id, title: task.title, durationMinutes: taskAdvice.suggested_minutes })}>生成待确认方案</Button></div>}
              <div className="work-timer-row">{session ? <><strong>{formatTimer(timerSeconds(session, tick))}</strong><span>{session.status === 'running' ? '正在计时' : session.status === 'paused' ? '已暂停' : '已结束，可手动记录'}</span>{session.status === 'running' && <Button className="button subtle" disabled={pending} onClick={() => timerAction(task, 'pause')}>暂停</Button>}{session.status === 'paused' && <Button className="button subtle" disabled={pending} onClick={() => timerAction(task, 'resume')}>继续</Button>}{session.status !== 'stopped' && <Button className="button subtle" disabled={pending} onClick={() => timerAction(task, 'finish')}>结束计时并填写反馈</Button>}</> : <Button className="button subtle" disabled={pending} onClick={() => timerAction(task, 'start')}>可选：开始计时</Button>}</div>
              {!taskId&&<div className="button-row"><Button className="button subtle" type="button" disabled={pending} onClick={() => setStatus(task, 'cancelled')}>取消任务</Button>{!task.parent_task_id&&<Button type="button" className="button subtle" disabled={pending} onClick={()=>convert(task)}>转为父容器</Button>}</div>}
              {recordingId === task.id && <form className="feedback-form" onSubmit={(event) => { event.preventDefault(); submitFeedback(task) }}><h5>保存本次执行情况</h5><Label>本次结果<NativeSelect value={form.outcome} onChange={(e) => setFeedbackForms((current) => ({ ...current, [task.id]: { ...form, outcome: e.target.value } }))}><option value="completed">完成</option><option value="partial">部分完成</option><option value="postponed">暂缓</option></NativeSelect></Label><Label>实际投入（分钟，可留空）<Input type="number" min="1" max="1440" value={form.actual_minutes} onChange={(e) => setFeedbackForms((current) => ({ ...current, [task.id]: { ...form, actual_minutes: e.target.value } }))} /></Label>{form.outcome === 'partial' && <Label>剩余时长（分钟）<Input type="number" min="5" max="1440" step="5" value={form.remaining_minutes} onChange={(e) => setFeedbackForms((current) => ({ ...current, [task.id]: { ...form, remaining_minutes: e.target.value } }))} /></Label>}<Label>难度感受<NativeSelect value={form.difficulty} onChange={(e) => setFeedbackForms((current) => ({ ...current, [task.id]: { ...form, difficulty: e.target.value } }))}><option value="easy">比预期容易</option><option value="expected">和预期差不多</option><option value="hard">比预期困难</option></NativeSelect></Label><Label>遇到什么情况（可选）<Input maxLength="500" value={form.reason} onChange={(e) => setFeedbackForms((current) => ({ ...current, [task.id]: { ...form, reason: e.target.value } }))} placeholder="例如：临时被打断、工作量增加" /></Label><div className="button-row"><Button className="button primary" disabled={pending}>保存记录</Button><Button className="button subtle" type="button" onClick={() => setRecordingId(null)}>暂不记录</Button></div></form>}
            </>}
            {editingId === task.id && <TaskForm recoveryWorkspace={recoveryWorkspace} key={task.id} task={task} pending={pending} onSubmit={(data) => save(data, task.id)} onCancel={() => setEditingId(null)} />}
            {feedbackCounts[task.id] > 0 && <details className="feedback-history" onToggle={async(event)=>{if(event.currentTarget.open&&!feedbacks[task.id])try{const result=await getTaskFeedback(task.id);setFeedbacks(current=>({...current,[task.id]:result.entries}))}catch(error){setActionError(error.message)}}}><summary>执行记录（{feedbackCounts[task.id]}）</summary>{(feedbacks[task.id]||[]).map((row) => <p key={row.id}>{row.outcome === 'completed' ? '完成' : row.outcome === 'partial' ? '部分完成' : '暂缓'} · {row.actual_minutes ? `投入 ${row.actual_minutes} 分钟` : '未记录耗时'}{row.reason ? ` · ${row.reason}` : ''}{row.superseded ? '（已更正）' : ''}</p>)}</details>}
          </article>
        }} />
      </div>}
    </section>
  )
}
