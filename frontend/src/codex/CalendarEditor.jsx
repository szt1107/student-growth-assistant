import { Alert } from './ui/controls.js'
import { Button, Input, Textarea, Label } from './ui/controls.js'
import {useRef,useState} from 'react'
import { Popover } from 'radix-ui'
import {apiTime} from './dayflow.js'
import {saveCalendarChange} from '../api.js'

export default function CalendarEditor({initial,revision,source,anchor,onClose,onSaved,onOpenTask,onManageRules}){
 const [value,setValue]=useState(initial),[error,setError]=useState(''),[busy,setBusy]=useState(false),[deleting,setDeleting]=useState(false)
 const request=useRef(null),returnFocus=useRef(typeof document!=='undefined'?document.activeElement:null),saving=useRef(false)
 const readOnly=['deadline','goal','course_snapshot'].includes(source?.kind)
 const narrow=typeof window!=='undefined'&&window.innerWidth<768
 const virtualAnchor=useRef({getBoundingClientRect:()=>anchor||new DOMRect(window.innerWidth/2,120,0,0)})
 const update=patch=>{setValue(current=>({...current,...patch}));setError('');setDeleting(false);request.current=null}
 async function submit(action){
  if(saving.current)return
  saving.current=true
  setBusy(true);setError('')
  try{
   if(request.current&&request.current.action!==action)request.current=null
   request.current ||= {...value,action,start:apiTime(value.start,value.all_day),end:apiTime(value.end,value.all_day),expected_revision:revision,client_request_id:crypto.randomUUID()}
   await saveCalendarChange(request.current)
   onSaved();onClose()
  }catch(cause){setError(cause.message)}finally{saving.current=false;setBusy(false)}
 }
 return <Popover.Root open modal={false} onOpenChange={open=>{if(!open&&!saving.current)onClose()}}><Popover.Anchor virtualRef={virtualAnchor}/><Popover.Portal><Popover.Content className="dayflow-inline-editor" data-calendar-editor="anchored" side={narrow?"bottom":"right"} align={narrow?"end":"start"} sideOffset={12} collisionPadding={12} sticky="always" aria-labelledby="calendar-editor-heading" aria-describedby="calendar-editor-description" onEscapeKeyDown={event=>{if(saving.current)event.preventDefault()}} onInteractOutside={event=>event.preventDefault()} onCloseAutoFocus={event=>{event.preventDefault();const previous=returnFocus.current;if(previous?.isConnected&&!previous.closest('[hidden],[inert]'))previous.focus()}}>
  <form onSubmit={event=>{event.preventDefault();submit('save')}}>
   <header className="dayflow-inline-heading"><div><h2 id="calendar-editor-heading">{readOnly?'查看事项':value.event_id?'编辑日程':'新建日程'}</h2><p id="calendar-editor-description">{source?.source||'我的日程'} · 北京时间</p></div><Button type="button" variant="ghost" size="icon" aria-label="关闭日程编辑" disabled={busy} onClick={onClose}>×</Button></header>
   {error&&<Alert variant="destructive" role="alert">{error}</Alert>}
   {source?.kind==='formal_task'&&<p className="helper">修改这一次安排；调整时长会同步任务预计时长，执行记录保留。任务需在当天08:00–22:00内、按5分钟对齐，不能超过截止时间。</p>}
   {(source?.kind==='course'||source?.kind==='protected'||source?.source_rule_id)&&<p className="helper">当前编辑只影响这一节。<Button type="button" className="button subtle" disabled={busy} onClick={()=>{onClose();onManageRules?.()}}>管理周期规则</Button></p>}
   {readOnly&&<p className="helper">{source.kind==='course_snapshot'?'历史课程快照保留原始记录。':'该节点由任务截止时间或长期目标生成，请到对应记录中修改。'}</p>}
   <fieldset className="dayflow-editor-fields" disabled={busy||readOnly}>
    <Label>事项名称<Input autoFocus required maxLength={160} value={value.title} onChange={e=>update({title:e.target.value})}/></Label>
    <Label className="dayflow-check"><Input type="checkbox" checked={value.all_day} onChange={e=>{const all_day=e.target.checked;update({all_day,start:all_day?value.start.slice(0,10):value.start+'T09:00',end:all_day?(value.end.slice(0,10)>value.start.slice(0,10)?value.end.slice(0,10):new Date(Date.parse(value.start.slice(0,10)+'T00:00:00Z')+86400000).toISOString().slice(0,10)):value.end+'T10:00'})}}/>全天</Label>
    <div className="dayflow-time-fields"><Label>开始<Input required type={value.all_day?'date':'datetime-local'} value={value.start} onChange={e=>update({start:e.target.value})}/></Label><Label>{value.all_day?'结束日期（不含）':'结束'}<Input required type={value.all_day?'date':'datetime-local'} value={value.end} onChange={e=>update({end:e.target.value})}/></Label></div>
    <Label>说明<Textarea rows={3} maxLength={4000} value={value.description} onChange={e=>update({description:e.target.value})}/></Label>
    <Label className="dayflow-check"><Input type="checkbox" checked={value.blocks_time} onChange={e=>update({blocks_time:e.target.checked})}/>占用时间，排程时避开</Label>
   </fieldset>
   {deleting&&<p className="recovery-note">确认移除这一次安排？关联任务、执行记录和历史复盘会保留。</p>}
   <footer className="dayflow-inline-footer">{!readOnly&&value.event_id&&<Button type="button" className="button subtle dayflow-delete" disabled={busy} onClick={()=>{if(deleting){request.current=null;submit('delete')}else setDeleting(true)}}>{deleting?'确认移除':'移除安排'}</Button>}
    {source?.task_id&&<Button type="button" className="button secondary" disabled={busy} onClick={()=>{onClose();onOpenTask?.(source.task_id)}}>查看关联任务</Button>}
    <Button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</Button>
    {!readOnly&&<Button type="submit" className="button primary" disabled={busy||!value.start||!value.end||!value.title.trim()}>{busy?'保存中…':value.event_id?'确认保存修改':'保存日程'}</Button>}
   </footer>
  </form>
 </Popover.Content></Popover.Portal></Popover.Root>
}
