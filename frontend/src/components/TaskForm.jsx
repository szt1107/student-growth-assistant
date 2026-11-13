import { Alert } from '../codex/ui/controls.js'
import { Button, Input, Textarea, NativeSelect, Label } from '../codex/ui/controls.js'
import { useState } from 'react'
import { toBackendDeadline, toDatetimeLocalValue } from '../datetime.js'
import EditRecovery, { useEditRecovery } from './EditRecovery.jsx'
import { editKey } from '../workbench.js'

export default function TaskForm({ task, pending, disabled = false, onSubmit, onCancel, recoveryWorkspace, recoveryResource }) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [duration, setDuration] = useState(task?.duration_minutes ?? 30)
  const [deadline, setDeadline] = useState(toDatetimeLocalValue(task?.deadline))
  const [priority, setPriority] = useState(task?.priority ?? 'normal')
  const [formError, setFormError] = useState('')
  const resource=recoveryResource||`task:${task?.id||'new'}`
  const baseline={title:task?.title??'',description:task?.description??'',duration:task?.duration_minutes??30,deadline:toDatetimeLocalValue(task?.deadline),priority:task?.priority??'normal'}
  const value={title,description,duration,deadline,priority}
  const recovery=useEditRecovery({workspace:recoveryWorkspace,resource,base:disabled?undefined:JSON.stringify(task||'unversioned-new-task'),
    value,dirty:JSON.stringify(value)!==JSON.stringify(baseline),restore:saved=>{setTitle(saved.title);setDescription(saved.description);setDuration(saved.duration);setDeadline(saved.deadline);setPriority(saved.priority)}})

  async function submit(event) {
    event.preventDefault()
    if (pending || disabled) return
    setFormError('')
    try {
      const saved=await onSubmit({
        title,
        description: description || null,
        duration_minutes: Number(duration),
        deadline: toBackendDeadline(deadline, task?.deadline),
        priority,
      })
      if(saved&&recoveryWorkspace)try{sessionStorage.removeItem(editKey(recoveryWorkspace,resource))}catch{/* recovery warning already shown */}
    } catch (error) {
      setFormError(error.message)
    }
  }

  return (
    <form onSubmit={submit} className="editor">
      <EditRecovery recovery={recovery} label="任务表单"/>
      <div className="form-grid">
        <Label className="span-two">标题
          <Input value={title} onChange={(event) => setTitle(event.target.value)} required disabled={pending || disabled} />
        </Label>
        <Label className="span-two">说明 <span className="optional">选填</span>
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows="2" disabled={pending || disabled} />
        </Label>
        <Label>{task?.task_kind === 'container' ? '原始预期（分钟，仅用于比较）' : '剩余时长（分钟）'}
          <Input type="number" min="5" step="5" value={duration} onChange={(event) => setDuration(event.target.value)} required disabled={pending || disabled} />
        </Label>
        <Label>截止时间
          <Input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} required disabled={pending || disabled} />
        </Label>
        <Label>重要程度
          <NativeSelect value={priority} onChange={(event) => setPriority(event.target.value)} disabled={pending || disabled}>
            <option value="low">低</option>
            <option value="normal">普通</option>
            <option value="high">高</option>
          </NativeSelect>
        </Label>
      </div>
      {formError && <Alert variant="destructive" role="alert">{formError}</Alert>}
      <div className="button-row">
        <Button className="button primary" type="submit" disabled={pending || disabled}>{pending ? '正在保存…' : task ? '保存任务' : '添加任务'}</Button>
        {onCancel && <Button className="button subtle" type="button" onClick={onCancel} disabled={pending}>取消</Button>}
      </div>
    </form>
  )
}
