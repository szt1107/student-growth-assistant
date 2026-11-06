import {Temporal} from 'temporal-polyfill'
import {shiftDate} from '../calendar.js'
import {mondayOfDate,toDatetimeLocalValue} from '../datetime.js'

export const groups=[
 {id:'personal',name:'我的日程',color:'#286653'},
 {id:'tasks',name:'任务安排',color:'#487bb6'},
 {id:'courses',name:'课程',color:'#b27c33'},
 {id:'protected',name:'保护时间',color:'#8e72aa'},
 {id:'markers',name:'截止与目标',color:'#bb6272'},
]
export const calendarGroup=kind=>kind==='formal_task'?'tasks':['course','course_snapshot'].includes(kind)?'courses':kind==='protected'?'protected':['deadline','goal'].includes(kind)?'markers':'personal'
export function toDayFlowEvent(event){
 const allDay=Boolean(event.allDay)
 const start=allDay?Temporal.PlainDate.from(event.start):Temporal.Instant.from(event.start).toZonedDateTimeISO('Asia/Shanghai')
 const end=allDay?Temporal.PlainDate.from(event.end||shiftDate(event.start,1)):Temporal.Instant.from(event.end).toZonedDateTimeISO('Asia/Shanghai')
 return {id:event.id,title:event.title,start,end,allDay,description:event.description||'',calendarId:event.calendar_group||calendarGroup(event.kind),meta:{source:event}}
}
function localValue(value,allDay){
 if(allDay)return value.toPlainDate?.().toString()||value.toString().slice(0,10)
 if(typeof value.epochMilliseconds==='number')return toDatetimeLocalValue(new Date(value.epochMilliseconds).toISOString())
 return value.toString().slice(0,16)
}
export function fieldsFromEvent(event){
 return {event_id:event.meta?.source?.id||null,title:event.title||'',description:event.description||'',
   start:localValue(event.start,event.allDay),end:localValue(event.end,event.allDay),
   all_day:Boolean(event.allDay),blocks_time:!['deadline','goal'].includes(event.meta?.source?.kind)&&event.meta?.source?.blocks_time!==false}
}
export function calendarRange(day,view){
 if(view==='year')return {start:day.slice(0,4)+'-01-01',end:String(Number(day.slice(0,4))+1)+'-01-01'}
 if(view==='day')return {start:day,end:shiftDate(day,1)}
 if(view==='week'){const start=mondayOfDate(day);return {start,end:shiftDate(start,7)}}
 const first=day.slice(0,7)+'-01',start=mondayOfDate(first)
 return {start,end:shiftDate(start,view==='agenda'?90:42)}
}
export function miniMonth(day){const first=mondayOfDate(day.slice(0,7)+'-01');return Array.from({length:42},(_,i)=>shiftDate(first,i))}
// DayFlow navigation Dates carry calendar fields in the browser's zone;
// event Temporal values independently carry their real Shanghai instants.
export const navigationDay=value=>`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`
export const navigationDate=day=>new Date(`${day}T12:00:00`)
export const apiTime=(value,allDay)=>allDay?value:`${value}:00+08:00`
