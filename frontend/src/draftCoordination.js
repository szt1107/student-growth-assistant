import { toBackendDeadline, toDatetimeLocalValue } from './datetime.js'

// Editors stay mounted across navigation. A send must settle valid local edits
// before asking AI to read/modify a draft. No business facts live in this map.
const editors=new Map()
export function registerEditor(key,editor){editors.set(key,editor);return()=>{if(editors.get(key)===editor)editors.delete(key)}}
export function hasUnsavedDraft(){return [...editors.values()].some(editor=>editor.dirty())}
export async function coordinateDrafts(){
  const refs=[]
  for(const editor of editors.values()){
    if(editor.dirty())await editor.save()
    const ref=await editor.reference?.()
    if(ref)refs.push(ref)
  }
  return refs
}

export const editableDraft=draft=>draft?.status==='ready'||Boolean(draft?.content?.schedule||draft?.kind==='planning'&&Array.isArray(draft?.content?.actions))&&['needs_input','conflict','no_plan'].includes(draft?.status)
// Dirty edits may resolve needs_input. The server must recalculate and return
// ready before confirmation; this only enables submitting the current editor.
export const canConfirmDraft=(draft,dirty)=>Boolean(editableDraft(draft)&&(dirty||draft.status==='ready'&&!draft.unresolved?.length))
export const draftPreviewPage=kind=>({planning:'schedule',breakdown:'schedule',profile:'profile',feedback:'review',review_record:'review'})[kind]

// Project the same editable form onto the calendar; no formal entries are written.
export function planningCalendarPreview(draft,asOf) {
  if(draft?.kind!=='planning'||!editableDraft(draft))return null
  const events=planningTaskFields(draft,draft.preview_content||draft.content).flatMap((task,index)=>{
    const windows=task.split_enabled?task.work_segments:[{start_at:task.start_at,end_at:task.end_at}]
    return windows.filter(window=>Number.isFinite(Date.parse(window.start_at))&&Date.parse(window.end_at)>Date.parse(window.start_at)&&!(Date.parse(window.start_at)<Date.parse(asOf)))
      .map((window,part)=>({id:`draft-preview:${draft.id}:${index}:${part}`,kind:'draft_preview',calendar_group:'draft-preview',
        title:`${task.title||'任务'} · 草案`,start:window.start_at,end:window.end_at,ref:task.ref,allDay:false}))
  }).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start))
  return {key:`planning:${draft.id}`,events,focusAt:events[0]?.start||null,asOf,
    taskIds:[...new Set(events.map(event=>/^task:(\d+)$/.exec(event.ref)?.[1]).filter(Boolean).map(Number))]}
}
export function previewCompletionDeadline(draft){
  if(!draft?.schedule_target)return null
  const items=(draft.items||[]).filter(item=>item.ref===draft.schedule_target&&Number.isFinite(Date.parse(item.end_at)))
  return items.reduce((latest,item)=>!latest||Date.parse(item.end_at)>Date.parse(latest)?item.end_at:latest,null)
}

function addPlanningMinutes(start, minutes) {
  if (!start || !Number.isFinite(minutes)) return ''
  const timestamp = Date.parse(start) + minutes * 60000
  if (!Number.isFinite(timestamp)) return ''
  if (timestamp%60000) return new Date(timestamp).toISOString()
  return toBackendDeadline(toDatetimeLocalValue(new Date(timestamp).toISOString()))
}

// Both persisted formats project onto the same form. Editing keeps their original
// API contracts, including task identity, locks and fields outside this form.
export function planningTaskFields(draft, content = draft.content) {
  const schedule = content.schedule
  const actions = draft.content.actions?.length
    ? content.actions
    : (draft.task_details || []).map(task => content.actions?.find(action=>action.target===task.ref) || {op:'update',target:task.ref,fields:{}})
  const entries = schedule ? [{target:draft.schedule_target,fields:schedule}] : actions
  return entries.map(entry => {
    const task = draft.task_details?.find(task => task.ref === entry.target) || {}
    const fields = {...task,...entry.fields}
    const items = (draft.items || [])
      .filter(item => item.ref === entry.target)
      .sort((a,b) => Date.parse(a.start_at)-Date.parse(b.start_at))
    const spanMinutes = items.length
      ? (Date.parse(items.at(-1).end_at)-Date.parse(items[0].start_at))/60000
      : 0
    const workMinutes = items.reduce((sum,item) => sum+(Date.parse(item.end_at)-Date.parse(item.start_at))/60000,0)
    let gapMinutes = schedule
      ? (schedule.break_minutes ?? 0)*((schedule.segments ?? 1)-1)
      : Math.max(0,spanMinutes-workMinutes)
    const footprintMinutes = Number.isFinite(fields.duration_minutes) ? fields.duration_minutes+gapMinutes : NaN
    let start, end, timeChanged = false
    let splitEnabled = (schedule?.segments ?? 1)>1
    let segments = schedule?.segments ?? 1
    let restMinutes = schedule?.break_minutes ?? 0
    let workSegments = []
    if (schedule) {
      const original = draft.content.schedule
      timeChanged = schedule.day!==original.day || schedule.start_time!==original.start_time || schedule.start_exact!==original.start_exact
      const layoutChanged = schedule.segments!==original.segments || schedule.break_minutes!==original.break_minutes
      workSegments = splitEnabled
        ? schedule.work_segments?.length ? schedule.work_segments : !layoutChanged && items.length>1 ? items : []
        : []
      if (!timeChanged && items.length) {
        start = items[0].start_at
      } else {
        start = schedule.day && schedule.start_time ? toBackendDeadline(`${schedule.day}T${schedule.start_time}`) : ''
      }
      end = !timeChanged && !layoutChanged && schedule.duration_minutes===original.duration_minutes && items.length
        ? items.at(-1).end_at
        : addPlanningMinutes(start,footprintMinutes)
    } else {
      const profile = {...task.profile,...entry.fields.profile}
      const original = draft.content.actions?.find(action => action.target===entry.target)?.fields.profile || {}
      const edited = entry.fields.profile || {}
      timeChanged = edited.fixed_start!==original.fixed_start || JSON.stringify(edited.allowed_windows || [])!==JSON.stringify(original.allowed_windows || [])
      const windows = timeChanged ? edited.allowed_windows || [] : items
      splitEnabled = Boolean(profile.splittable)
      segments = splitEnabled ? profile.segment_count || (windows.length>1 ? windows.length : 2) : 1
      const originalCount = task.profile?.segment_count || draft.content.actions?.find(action=>action.target===entry.target)?.fields.profile?.segment_count
      const countChanged = profile.segment_count && profile.segment_count!==originalCount
      const pinned = profile.allowed_windows?.length>1 && profile.segment_count===profile.allowed_windows.length &&
        Date.parse(profile.fixed_start)===Date.parse(profile.allowed_windows[0].start_at)
      workSegments = splitEnabled && !countChanged && fields.duration_minutes===task.duration_minutes
        ? (timeChanged && windows.length>1 ? windows : items.length>1 ? items : pinned ? profile.allowed_windows : [])
        : []
      if (splitEnabled && timeChanged && windows.length===segments && windows.length>1) workSegments=windows
      const rest = windows.length>1 ? (Date.parse(windows[1].start_at)-Date.parse(windows[0].end_at))/60000 : 0
      restMinutes = splitEnabled ? profile.min_break_minutes ?? (Number.isFinite(rest)&&rest<=120?Math.max(0,rest):0) : 0
      if (timeChanged) {
        start = edited.fixed_start==='' ? '' : edited.allowed_windows?.[0]?.start_at || ''
        end = edited.fixed_start==='' ? '' : edited.allowed_windows?.at(-1)?.end_at || ''
        gapMinutes = windows.slice(1).reduce((sum,window,i)=>{
          const rest = (Date.parse(window.start_at)-Date.parse(windows[i].end_at))/60000
          return sum+(Number.isFinite(rest)?Math.max(0,rest):0)
        },0)
      } else {
        start = items[0]?.start_at || profile.fixed_start || profile.preferred_windows?.[0]?.start_at || profile.allowed_windows?.[0]?.start_at || ''
        end = items.length && fields.duration_minutes===task.duration_minutes
          ? items.at(-1).end_at
          : addPlanningMinutes(start,footprintMinutes)
      }
    }
    if (workSegments.length) {
      start=workSegments[0].start_at
      end=workSegments.at(-1).end_at
      gapMinutes=workSegments.slice(1).reduce((sum,window,index)=>sum+
        Math.max(0,(Date.parse(window.start_at)-Date.parse(workSegments[index].end_at))/60000),0)
    }
    return {
      ref:entry.target,
      title:fields.title || '',
      duration_minutes:fields.duration_minutes ?? null,
      deadline:fields.deadline ?? null,
      priority:fields.priority || 'normal',
      start_at:start,
      end_at:end,
      gap_minutes:gapMinutes,
      time_edited:timeChanged,
      split_enabled:splitEnabled,
      segments,
      break_minutes:restMinutes,
      work_segments:workSegments.map(window=>({start_at:window.start_at,end_at:window.end_at})),
    }
  })
}

export function editPlanningTask(draft, content, index, patch) {
  const task = planningTaskFields(draft,content)[index]
  const timeChanged = Object.hasOwn(patch,'start_at') || Object.hasOwn(patch,'end_at')
  const splitChanged = ['split_enabled','segments','break_minutes'].some(key=>Object.hasOwn(patch,key))
  if (content.schedule) {
    const schedule = {...content.schedule,...patch}
    if (splitChanged) {
      const enabled = patch.split_enabled ?? task.split_enabled
      schedule.segments = enabled ? patch.segments ?? (task.split_enabled?task.segments:2) : 1
      schedule.break_minutes = enabled ? patch.break_minutes ?? task.break_minutes : 0
      schedule.work_segments = []
      schedule.min_block_minutes = 5
      delete schedule.split_enabled
    }
    if (Object.hasOwn(patch,'duration_minutes') && patch.duration_minutes!==task.duration_minutes && task.split_enabled) schedule.work_segments=[]
    if (patch.work_segments?.[0]?.start_at) {
      if (Object.hasOwn(schedule,'time_period')) schedule.time_period=null
      schedule.min_block_minutes=5
      const local=toDatetimeLocalValue(patch.work_segments[0].start_at)
      schedule.day=local.slice(0,10)
      schedule.start_time=local.slice(11)
      schedule.start_exact=true
    }
    if (timeChanged) {
      if (Object.hasOwn(schedule,'time_period')) schedule.time_period=null
      const start = Object.hasOwn(patch,'start_at') ? patch.start_at : task.start_at
      const local = toDatetimeLocalValue(start)
      schedule.day = local.slice(0,10)
      schedule.start_time = local.slice(11)
      schedule.start_exact = true
      if (Object.hasOwn(patch,'end_at')) {
        schedule.duration_minutes = start && patch.end_at
          ? (Date.parse(patch.end_at)-Date.parse(start))/60000-task.gap_minutes
          : null
      }
      delete schedule.start_at
      delete schedule.end_at
      if (task.work_segments.length) {
        const offset=(Date.parse(start)-Date.parse(task.work_segments[0].start_at))/60000
        schedule.work_segments=task.work_segments.map((window,index)=>({
          start_at:addPlanningMinutes(window.start_at,offset),
          end_at:index===task.work_segments.length-1 && Object.hasOwn(patch,'end_at')
            ? patch.end_at : addPlanningMinutes(window.end_at,offset),
        }))
      }
    }
    return {...content,schedule}
  }
  const actions = [...(content.actions || [])]
  let actionIndex = actions.findIndex(action => action.target===task.ref)
  if (actionIndex<0) {
    actionIndex = actions.length
    actions.push({op:'update',target:task.ref,fields:{}})
  }
  const action = actions[actionIndex]
  let fields = {...action.fields,...patch}
  if (Object.hasOwn(patch,'work_segments')) {
    fields={...action.fields,profile:{...action.fields.profile,
      fixed_start:patch.work_segments[0]?.start_at || null,allowed_windows:patch.work_segments,
      splittable:true,segment_count:task.segments,max_segments:task.segments,min_block_minutes:5}}
  } else if (splitChanged) {
    const enabled = patch.split_enabled ?? task.split_enabled
    const count = enabled ? patch.segments ?? (task.split_enabled?task.segments:2) : 1
    const rest = enabled ? patch.break_minutes ?? task.break_minutes : 0
    fields = {
      ...action.fields,
      duration_minutes:task.duration_minutes,
      profile:{...action.fields.profile,splittable:enabled,max_segments:count,segment_count:count,
        min_block_minutes:5,min_break_minutes:rest},
    }
    if (!enabled) fields.profile.allowed_windows=[{start_at:task.start_at,end_at:addPlanningMinutes(task.start_at,task.duration_minutes)}]
  } else if (timeChanged) {
    const start = Object.hasOwn(patch,'start_at') ? patch.start_at : task.start_at
    const footprintMinutes = Number.isFinite(task.duration_minutes) ? task.duration_minutes+task.gap_minutes : NaN
    const end = Object.hasOwn(patch,'end_at') ? patch.end_at : addPlanningMinutes(start,footprintMinutes)
    const originalItems = (task.time_edited
      ? [...(action.fields.profile?.allowed_windows || [])]
      : (draft.items || []).filter(item => item.ref===task.ref))
      .sort((a,b)=>Date.parse(a.start_at)-Date.parse(b.start_at))
    const offsetMinutes = (Date.parse(start)-Date.parse(originalItems[0]?.start_at))/60000
    const windows = !start
      ? originalItems.map(item=>({start_at:item.start_at,end_at:item.end_at}))
      : originalItems.length>1 && Number.isFinite(offsetMinutes)
      ? originalItems.map((item,i)=>({
          start_at:addPlanningMinutes(item.start_at,offsetMinutes),
          end_at:i===originalItems.length-1 ? end : addPlanningMinutes(item.end_at,offsetMinutes),
        }))
      : [{start_at:start,end_at:end}]
    let durationMinutes = task.duration_minutes
    if (Object.hasOwn(patch,'end_at')) {
      durationMinutes = start && end ? (Date.parse(end)-Date.parse(start))/60000-task.gap_minutes : null
    }
    fields = {
      ...action.fields,
      duration_minutes:durationMinutes,
      profile:{...action.fields.profile,fixed_start:start,allowed_windows:windows},
    }
  } else if (Object.hasOwn(patch,'duration_minutes') && patch.duration_minutes!==task.duration_minutes && task.time_edited && action.fields.profile?.allowed_windows?.length) {
    const day=toDatetimeLocalValue(task.start_at).slice(0,10)
    fields.profile = {...action.fields.profile,allowed_windows:[{
      start_at:toBackendDeadline(`${day}T08:00`),end_at:toBackendDeadline(`${day}T22:00`),
    }],min_block_minutes:5}
  }
  actions[actionIndex] = {...action,fields}
  return {...content,actions}
}

export function planningDraftPayload(draft, content) {
  for (const task of planningTaskFields(draft,content)) {
    if (!Number.isInteger(task.segments) || task.segments<1 || task.segments>8) throw Error('分段数需为1到8的整数。')
    if (!Number.isInteger(task.break_minutes) || task.break_minutes<0 || task.break_minutes>120 || task.break_minutes%5) throw Error('段间休息须为5分钟的整数倍，范围为0至120分钟。')
    if (!Number.isFinite(Date.parse(task.start_at)) || !Number.isFinite(Date.parse(task.end_at)) || Date.parse(task.end_at)<=Date.parse(task.start_at)) {
      throw Error('请填写完整的开始时间和结束时间，结束时间需要晚于开始时间。')
    }
    if (!Number.isInteger(task.duration_minutes) || task.duration_minutes<5 || task.duration_minutes>1440 || task.duration_minutes%5) {
      throw Error('预计分钟须为5分钟的整数倍，范围为5至1440分钟。')
    }
    if (task.duration_minutes<task.segments*5) throw Error('每段至少需要5分钟，请减少分段数。')
    if (task.work_segments.length) {
      if (task.work_segments.length!==task.segments) throw Error('请点击“分段”更新安排，或调整分段数。')
      let total=0
      for (const [index,window] of task.work_segments.entries()) {
        const minutes=(Date.parse(window.end_at)-Date.parse(window.start_at))/60000
        if (!Number.isInteger(minutes) || minutes<5 || minutes%5) throw Error('每段时间须完整填写，且为5分钟的整数倍。')
        const start=new Date(window.start_at)
        if(start.getUTCMinutes()%5||start.getUTCSeconds()||start.getUTCMilliseconds())throw Error('各段起止时间须在5分钟网格上。')
        if (index && Date.parse(window.start_at)<Date.parse(task.work_segments[index-1].end_at)) throw Error('分段时间不能重叠，请按先后顺序填写。')
        total+=minutes
      }
      if (total!==task.duration_minutes) throw Error(`各段合计${total}分钟，需与预计${task.duration_minutes}分钟一致。`)
    }
  }
  for (const action of content.actions || []) {
    for (const window of action.fields.profile?.allowed_windows || []) {
      const minutes = (Date.parse(window.end_at)-Date.parse(window.start_at))/60000
      if (!Number.isFinite(minutes) || minutes<=0 || minutes%5) throw Error('每段工作时长须为5分钟的整数倍，请调整预计分钟、分段数或结束时间。')
    }
  }
  return content
}
