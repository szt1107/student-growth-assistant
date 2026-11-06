import { Alert } from './ui/controls.js'
import { Button, Input, Label } from './ui/controls.js'
import {useEffect,useMemo,useRef,useState} from 'react'
import { PanelLeft, Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import {DayFlowCalendar,useCalendarApp,createDayView,createWeekView,createMonthView,createYearView,createAgendaView,createEventsPlugin} from '@dayflow/react'
import {createDragPlugin} from '@dayflow/plugin-drag'
import {createLocalizationPlugin,zh} from '@dayflow/plugin-localization'
import '@dayflow/core/dist/styles.components.css'
import {getCalendarEvents} from '../api.js'
import {toDayFlowEvent,fieldsFromEvent,groups,calendarGroup,calendarRange,miniMonth,navigationDay,navigationDate} from './dayflow.js'
import CalendarEditor from './CalendarEditor.jsx'
import {useEditRecovery} from '../components/EditRecovery.jsx'
import {shiftDate} from '../calendar.js'
import './dayflow.css'
import './calendar-surface.css'

export default function DayFlowWorkspace({workspace,today,active,refreshVersion,onOpenTask,onDataChanged,onManageRules,compact=false}){
 const initialView=compact?'day':'week'
 const [day,setDay]=useState(today),[view,setView]=useState(initialView),[range,setRange]=useState(()=>calendarRange(today,initialView))
 const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0)
 const [editing,setEditing]=useState(null),[notice,setNotice]=useState(''),[search,setSearch]=useState(''),[sidebar,setSidebar]=useState(false)
 const [hidden,setHidden]=useState([]),[miniDate,setMiniDate]=useState(today)
 const appRef=useRef(null),latest=useRef(null),fetchId=useRef(0),editRef=useRef(null),deleteTimer=useRef(null),surface=useRef(null),pointerAnchor=useRef(null),loadedRange=useRef(null)
 latest.current={data,editing,day,view}
 const views=useMemo(()=>[createDayView({showHalfHourLines:true,hourHeight:72,firstHour:0,lastHour:24,scrollToCurrentTime:false}),createWeekView({startOfWeek:1,showHalfHourLines:true,hourHeight:72,firstHour:0,lastHour:24,scrollToCurrentTime:false}),createMonthView({startOfWeek:1}),createYearView({startOfWeek:1}),createAgendaView()],[])
 const plugins=useMemo(()=>[createDragPlugin({enableCreate:true,enableDrag:true,enableResize:true,onEventDrop:event=>editRef.current?.(event),onEventResize:event=>editRef.current?.(event)}),createEventsPlugin(),createLocalizationPlugin({locales:[zh]})],[])
 const calendars=useMemo(()=>groups.map(g=>({id:g.id,name:g.name,readOnly:g.id==='markers',isVisible:!hidden.includes(g.id),colors:{lineColor:g.color,eventColor:g.color+'20',eventSelectedColor:g.color+'35',textColor:g.color}})),[hidden])
 const rendered=useMemo(()=>(data?.events||[]).filter(e=>!hidden.includes(e.calendar_group||calendarGroup(e.kind))&&(!search||e.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))).map(toDayFlowEvent),[data,search,hidden])
 const restoreEvents=()=>{
  const app=appRef.current?.app;if(!app)return
  const existing=new Map(app.getAllEvents().map(event=>[event.id,event])),incoming=new Map(rendered.map(event=>[event.id,event]))
  const add=rendered.filter(event=>!existing.has(event.id)),remove=[...existing.keys()].filter(id=>!incoming.has(id))
  const update=rendered.filter(event=>{const previous=existing.get(event.id);return previous&&(previous.start.toString()!==event.start.toString()||previous.end.toString()!==event.end.toString()||previous.title!==event.title||previous.allDay!==event.allDay||previous.description!==event.description||previous.calendarId!==event.calendarId||JSON.stringify(previous.meta)!==JSON.stringify(event.meta))}).map(event=>({id:event.id,updates:event}))
  if(add.length||remove.length||update.length)app.applyEventsChanges({delete:remove,add,update},false,'remote')
 }
 function editEvent(event,created=false){
  if(latest.current.editing)return
  if(!latest.current.data){setNotice('日程尚未加载，请稍后重试。');restoreEvents();return}
  const node=[...(surface.current?.querySelectorAll('[data-event-id]')||[])].find(node=>node.dataset.eventId===event.id)
  const anchor=created?pointerAnchor.current:node?.getBoundingClientRect()||pointerAnchor.current
  setEditing({fields:{...fieldsFromEvent(event),event_id:created?null:event.meta?.source?.id||event.id},source:created?null:event.meta?.source,revision:latest.current.data.revision,anchor})
  restoreEvents()
 }
 editRef.current=editEvent
 const calendar=useCalendarApp({views,plugins,calendars,events:rendered,initialDate:navigationDate(today),defaultView:initialView,locale:'zh-CN',timeZone:'Asia/Shanghai',timeFormat:'24h',useEventDetailDialog:false,useEventDetailPanel:false,useCalendarHeader:false,
  callbacks:{onDateChange:date=>{const next=navigationDay(date);setDay(next);setMiniDate(next);setRange(calendarRange(next,latest.current.view))},
   onViewChange:next=>{setView(next);setRange(calendarRange(latest.current.day,next))},
   onVisibleRangeChange:(start,end)=>{
    const a=navigationDay(start),b=navigationDay(end)
    if(a>='2000-01-01'&&b<='2101-01-01'&&a<b&&Date.parse(b)-Date.parse(a)<=370*86400000)setRange(previous=>previous.start===a&&previous.end===b?previous:{start:a,end:b})
   },onEventClick:event=>editEvent(event),onEventCreate:event=>editEvent(event,true),onEventUpdate:event=>editEvent(event),
   onEventDelete:id=>{const event=appRef.current?.app.getAllEvents().find(event=>event.id===id);if(event)editRef.current?.(event);clearTimeout(deleteTimer.current);deleteTimer.current=setTimeout(()=>restoreEvents(),0)}}})
 appRef.current=calendar
 useEffect(()=>{restoreEvents()},[rendered,calendar.app])
 useEffect(()=>()=>clearTimeout(deleteTimer.current),[])
 useEditRecovery({workspace,resource:compact?'dayflow-calendar-auxiliary':'dayflow-calendar',base:'dayflow-v1',value:{day,view},dirty:true,automatic:true,restore:value=>{
  if(/^20\d\d-\d\d-\d\d$/.test(value.day)&&['day','week','month','year','agenda'].includes(value.view)){
   setDay(value.day);setView(value.view);setMiniDate(value.day);setRange(calendarRange(value.day,value.view));calendar.selectDate(navigationDate(value.day));calendar.changeView(value.view)
  }}})
 useEffect(()=>{
  if(!active||!['day','week'].includes(view))return
  let frame,attempts=0
  const position=()=>{
   const scroller=surface.current?.querySelector('.dayflow-canvas .df-calendar-content')
   if(scroller&&scroller.clientHeight>0&&scroller.scrollHeight>scroller.clientHeight){scroller.scrollTop=8*72;return}
   if(++attempts<120)frame=requestAnimationFrame(position)
  }
  frame=requestAnimationFrame(position)
  return()=>cancelAnimationFrame(frame)
 },[active,day,view])
 useEffect(()=>{
  if(!active)return
  const cached=loadedRange.current
  if(cached&&cached.start<=range.start&&cached.end>=range.end&&cached.version===refreshVersion&&cached.retry===retry){setLoading(false);return}
  const token=++fetchId.current
  // Virtual scrolling emits many overlapping ranges. Fetch a surrounding window
  // after scrolling settles rather than reload and replace the calendar each frame.
  const days=(Date.parse(range.end)-Date.parse(range.start))/86400000,padding=days<=280?42:0
  const start=padding?(shiftDate(range.start,-padding)<'2000-01-01'?'2000-01-01':shiftDate(range.start,-padding)):range.start,end=padding?(shiftDate(range.end,padding)>'2101-01-01'?'2101-01-01':shiftDate(range.end,padding)):range.end
  const timer=setTimeout(()=>{
   setLoading(true);setError('')
   getCalendarEvents(start,end).then(next=>{if(fetchId.current===token){loadedRange.current={start,end,version:refreshVersion,retry};setData(next)}}).catch(cause=>{if(fetchId.current===token)setError(cause.message)}).finally(()=>{if(fetchId.current===token)setLoading(false)})
  },latest.current.data?180:0)
  return()=>{clearTimeout(timer);fetchId.current++}
 },[active,range.start,range.end,refreshVersion,retry])
 useEffect(()=>{if(!active&&editing){setEditing(null);restoreEvents()}},[active])
 const jump=date=>{calendar.selectDate(navigationDate(date));setDay(date);setMiniDate(date);setRange(calendarRange(date,view));setSidebar(false)}
 const closeEditor=()=>{setEditing(null);restoreEvents()}
 const create=event=>{if(!data||latest.current.editing)return;setEditing({fields:{event_id:null,title:'',description:'',all_day:false,blocks_time:true,start:day+'T09:00',end:day+'T10:00'},revision:data.revision,anchor:event.currentTarget.getBoundingClientRect()})}
 const changeView=next=>{calendar.changeView(next);setView(next);setRange(calendarRange(day,next))}
 const moveMonth=delta=>{const d=new Date(miniDate.slice(0,7)+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+delta);setMiniDate(d.toISOString().slice(0,10))}
 const cells=miniMonth(miniDate)
 return <section ref={surface} onPointerDownCapture={event=>{const cell=event.target.closest('.df-week-time-grid-cell,.df-day-time-grid-cell,[data-date],[data-event-id]');pointerAnchor.current=cell?.getBoundingClientRect()||new DOMRect(event.clientX,event.clientY,1,1)}} className="dayflow-workspace" aria-label={compact?'侧栏日历':'完整日历'} data-engine="dayflow" data-compact={compact||undefined}>
  <div className="dayflow-toolbar">
   <div className="dayflow-period"><Button type="button" size="icon" className={'size-9 p-0 max-lg:size-11 '+(compact?'dayflow-compact-sidebar-toggle':'dayflow-sidebar-toggle')} aria-label="日期与分类" title="日期与分类" aria-expanded={sidebar} onClick={()=>setSidebar(!sidebar)}><PanelLeft aria-hidden="true"/></Button><strong>{view==='year'?day.slice(0,4)+'年':<><span className="dayflow-period-year">{day.slice(0,4)}年</span>{Number(day.slice(5,7))}月{view==='day'?Number(day.slice(8,10))+'日':''}</>}</strong></div>
   <div className="dayflow-date-nav"><Button type="button" size="icon" className="size-9 p-0 max-lg:size-11" aria-label="日历上一段" onClick={()=>calendar.goToPrevious()}><ChevronLeft aria-hidden="true"/></Button><Button type="button" className="px-2 py-1.5" onClick={()=>jump(today)}>今天</Button><Button type="button" size="icon" className="size-9 p-0 max-lg:size-11" aria-label="日历下一段" onClick={()=>calendar.goToNext()}><ChevronRight aria-hidden="true"/></Button></div>
   <div className="dayflow-views" role="group" aria-label="日历视图">{[['day','日'],['week','周'],['month','月'],['year','年'],['agenda','列表']].map(([key,label])=><Button type="button" className="px-2 py-1.5" key={key} aria-pressed={view===key} onClick={()=>changeView(key)}>{label}</Button>)}</div>
   <Button type="button" aria-label="＋ 新建日程" className="button primary dayflow-create px-3" disabled={!data||Boolean(editing)} onClick={create}><Plus aria-hidden="true"/><span className="dayflow-create-label">新建日程</span></Button>
  </div>
  {error&&<Alert variant="destructive" role="alert">{error}<Button className="button subtle" onClick={()=>setRetry(x=>x+1)}>重试读取</Button></Alert>}
  {notice&&<p role="status" className="helper">{notice}<Button className="button subtle" onClick={()=>setNotice('')}>知道了</Button></p>}
  <div className="dayflow-body">
   <aside className="dayflow-sidebar" data-mobile-open={sidebar} aria-label="日历日期与分类">
    <Label className="dayflow-search"><Input type="search" aria-label="搜索日历事项" placeholder="搜索日程…" value={search} onChange={e=>setSearch(e.target.value)}/></Label>
    <div className="dayflow-mini-heading"><Button type="button" aria-label="小月历上个月" onClick={()=>moveMonth(-1)}>‹</Button><strong>{miniDate.slice(0,4)}年{Number(miniDate.slice(5,7))}月</strong><Button type="button" aria-label="小月历下个月" onClick={()=>moveMonth(1)}>›</Button></div>
    <div className="dayflow-mini" role="group" aria-label="选择日历日期">{['一','二','三','四','五','六','日'].map(x=><span key={x}>{x}</span>)}{cells.map(date=><Button type="button" key={date} aria-label={date} aria-pressed={day===date} data-outside={date.slice(0,7)!==miniDate.slice(0,7)} data-today={date===today} onClick={()=>jump(date)}>{Number(date.slice(-2))}</Button>)}</div>
    <div className="dayflow-groups"><h3>我的日历</h3>{groups.map(g=><Label key={g.id}><Input type="checkbox" style={{accentColor:g.color}} checked={!hidden.includes(g.id)} onChange={e=>setHidden(current=>e.target.checked?current.filter(x=>x!==g.id):[...current,g.id])}/>{g.name}</Label>)}</div>
   </aside>
   <div className="dayflow-canvas" aria-busy={loading}>{loading&&!data&&<span className="dayflow-loading" role="status">正在读取日程…</span>}<DayFlowCalendar calendar={calendar}/></div>
  </div>
  {data?.conflicts?.length>0&&<p className="helper">当前范围存在重叠事项，可点击查看并调整。</p>}
  {editing&&<CalendarEditor initial={editing.fields} revision={editing.revision} source={editing.source} anchor={editing.anchor} onClose={closeEditor} onSaved={()=>{setRetry(x=>x+1);onDataChanged?.()}} onOpenTask={onOpenTask} onManageRules={onManageRules}/>}
 </section>
}
