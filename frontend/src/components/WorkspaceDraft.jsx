import { Alert, Badge } from '../codex/ui/controls.js'
import { useConfirmation } from '../codex/ui/confirmation-provider.jsx'
import { Button, Input, Textarea, NativeSelect, Label } from '../codex/ui/controls.js'
import { useEffect,useLayoutEffect,useRef,useState } from 'react'
import { getWorkspaceDraft,editWorkspaceDraft,splitWorkspaceDraft,actWorkspaceDraft } from '../api.js'
import { registerEditor,editableDraft,canConfirmDraft,previewCompletionDeadline,planningTaskFields,editPlanningTask,planningDraftPayload } from '../draftCoordination.js'
import { BreakdownEditor } from './TaskBreakdown.jsx'
import { editableContent,breakdownPayload } from '../taskHierarchy.js'
import EditRecovery,{useEditRecovery} from './EditRecovery.jsx'
import { toDatetimeLocalValue,toBackendDeadline } from '../datetime.js'
import { shiftDate } from '../calendar.js'

export const draftLabels={planning:'日程方案',breakdown:'任务拆解',profile:'档案修改',feedback:'执行反馈',review_record:'复盘记录'}
export const draftEvent=()=>window.dispatchEvent(new Event('sga-drafts-changed'))
const statusLabels={ready:'待审核',applied:'已保存',stale:'资料已变化',superseded:'已有更新版本',discarded:'已放弃',conflict:'存在冲突',needs_input:'需要补充信息',no_plan:'尚无完整方案'}
const fieldLabels={title:'名称',description:'说明',duration_minutes:'预计分钟',deadline:'截止时间',motivation:'为什么重要',weekly_target:'每周目标',unit_label:'单位',name:'名称',actual_minutes:'实际投入分钟',remaining_minutes:'剩余分钟',reason:'原因',summary:'回顾摘要',conclusion:'我的结论',next_steps:'下一步（可空）',priority:'优先顺序',text:'参考说明',hours:'小时',start:'开始时间',end:'结束时间',due_date:'目标日期',metric_kind:'衡量方式',goal_type:'目标类型',enabled:'启用'}
Object.assign(fieldLabels,{start_time:'开始时间',end_time:'结束时间',date:'指定日期',weekday:'星期',recurrence:'重复方式',kind:'时间类型',active:'启用规则'})
const operationLabels={create_time_rule:'新增课程或保护时间',update_time_rule:'修改课程或保护时间',work_timer:'计时操作',record_feedback:'执行反馈建议',create_goal:'目标建议'}
export function PreviewDetails({draft}){
  if(draft?.kind==='planning')return null
  return <>{draft?.unresolved?.map(note=><p className="recovery-note" key={note}>{note}</p>)}{draft?.notices?.filter((note,index,all)=>all.indexOf(note)===index).map(note=><p className="helper" key={note}>{note}</p>)}</>
}

export function PlanningProblems({draft}) {
  if(!draft||!['needs_input','conflict','no_plan'].includes(draft.status))return null
  const hasScheduledTask=draft.items?.some(item=>item.ref===draft.schedule_target)
  const problems=draft.problems?.length
    ? draft.problems.filter(problem=>problem.code!=='DEADLINE_REQUIRED'||!hasScheduledTask)
    : (draft.diagnostics||[])
      .filter(item=>['FIXED_TIME_CONFLICT','FIXED_TASK_CONFLICT','NO_CONTINUOUS_SLOT','SEARCH_LIMIT','NO_PLAN_FOUND'].includes(item.code))
      .map(item=>({message:item.message,suggestion:'请调整开始时间、结束时间或截止时间，再保存草案重新检查。'}))
  if(!problems.length)return null
  const messages=[...new Set(problems.map(item=>item.message))]
  const suggestions=draft.requires_recalculation?['点击“保存草案编辑”，系统会根据现有日程自动更新这份草案。']:[...new Set(problems.map(item=>item.suggestion?.replaceAll('建议开始时间','开始时间').replaceAll('希望完成日期','开始时间中的日期')).filter(Boolean))]
  return <Alert variant="destructive" role="alert" aria-label="安排需要调整">
    {messages.map(message=><p key={message}>{message}</p>)}
    {suggestions.map(suggestion=><p key={suggestion}>{suggestion}</p>)}
  </Alert>
}

export function PlanningTaskFields({value,onChange,onSplit,splitting=false}) {
  return <>
    <Fields value={{title:value.title,duration_minutes:value.duration_minutes,deadline:value.deadline,priority:value.priority}} onChange={onChange}/>
    {!value.split_enabled&&<div className="form-grid">
      {[['start_at','开始时间'],['end_at','结束时间']].map(([key,label])=><Label key={key}>{label}
        <Input type="datetime-local" step="300" value={toDatetimeLocalValue(value[key])}
          onChange={event=>onChange({[key]:event.target.value?toBackendDeadline(event.target.value,value[key]):''})}/>
      </Label>)}
    </div>}
    <Label className="flex min-h-11 items-center gap-2">
      <Input type="checkbox" checked={Boolean(value.split_enabled)} disabled={!value.split_enabled&&value.duration_minutes<10}
        onChange={event=>onChange({split_enabled:event.target.checked})}/>允许分段
    </Label>
    {value.split_enabled&&<>
      <div className="planning-split-controls">
        <Label>分段数量<Input type="number" min="2" max="8" step="1" value={value.segments} onChange={event=>onChange({segments:Number(event.target.value)})}/></Label>
        <Button type="button" className="button secondary" disabled={!onSplit||splitting} onClick={onSplit}>{splitting?'分段中…':'分段'}</Button>
      </div>
      {value.work_segments.map((window,index)=><div className="form-grid" key={index}>
        {[['start_at',`开始时间${index+1}`],['end_at',`结束时间${index+1}`]].map(([key,label])=><Label key={key}>{label}
          <Input type="datetime-local" step="300" value={toDatetimeLocalValue(window[key])}
            onChange={event=>onChange({work_segments:value.work_segments.map((previous,item)=>item===index
              ? {...previous,[key]:event.target.value?toBackendDeadline(event.target.value,previous[key]):''} : previous)})}/>
        </Label>)}
      </div>)}
    </>}
  </>
}

export function PlanningFields({draft,content=draft.content,onChange,onSplit,splittingIndex}) {
  return <>{planningTaskFields(draft,content).map((task,index)=><section className="draft-operation" key={task.ref||index} aria-label={`任务安排 ${index+1}`}>
    <PlanningTaskFields value={task} onChange={patch=>onChange?.(editPlanningTask(draft,content,index,patch))}
      onSplit={onSplit?()=>onSplit(index):undefined} splitting={splittingIndex===index}/>
  </section>)}</>
}

function Fields({value,onChange}){
  return <div className="form-grid">{Object.entries(value).map(([key,item])=>{
    if(key==='action'&&value.op==='work_timer')return <p key={key}>计时操作：{{start:'开始',pause:'暂停',resume:'继续',finish:'结束'}[item]}（不会自动完成任务）</p>
    if(key==='task_id')return <p key={key}>关联任务 #{item}</p>
    if(key==='id'&&value.op==='update_time_rule')return <p key={key}>时间规则 #{item}</p>
    if(key==='session_id'&&value.op==='work_timer')return <p key={key}>计时记录 #{item}</p>
    if(['fields','parameters','settings','profile'].includes(key)&&item&&typeof item==='object')return <Fields key={key} value={item} onChange={next=>onChange({...value,[key]:next})}/>
    if(['metric_kind','goal_type','status','adjustment_mode','mode','priority'].includes(key)){
      const options=key==='metric_kind'?[['time','投入时长'],['count','次数'],['deliverable','成果物']]:key==='goal_type'?[['long_term','长期'],['stage','阶段']]:key==='status'?[['active','进行中'],['paused','暂停'],['completed','已完成'],['archived','归档']]:key==='priority'?(typeof item==='number'?[[1,'最优先'],[2,'重要'],[3,'保持推进']]:[['high','高'],['normal','普通'],['low','低']]):[['balanced','兼顾'],['preference','习惯优先'],['stable','稳定优先']]
      return <Label key={key}>{fieldLabels[key]||'安排取舍'}<NativeSelect value={item} onChange={e=>onChange({...value,[key]:typeof item==='number'?Number(e.target.value):e.target.value})}>{options.map(([v,label])=><option key={v} value={v}>{label}</option>)}</NativeSelect></Label>
    }
    if(key==='enabled'||key==='active')return <Label key={key}>{fieldLabels[key]||'启用'}<Input type="checkbox" checked={Boolean(item)} onChange={e=>onChange({...value,[key]:e.target.checked})}/></Label>
    if(key==='recurrence'||key==='kind'&&['course','protected'].includes(item))return <p key={key}>{fieldLabels[key]}：{{weekly:'每周',once:'单次',course:'课程',protected:'保护时间'}[item]}{key==='recurrence'?'（调整重复方式请继续告诉助手）':''}</p>
    if(key==='weekday')return <Label key={key}>星期<NativeSelect value={item??''} onChange={e=>onChange({...value,weekday:Number(e.target.value)})}>{['一','二','三','四','五','六','日'].map((day,i)=><option key={day} value={i+1}>星期{day}</option>)}</NativeSelect></Label>
    if(key==='start_time'||key==='end_time'||key==='date')return <Label key={key}>{fieldLabels[key]}<Input type={key==='date'?'date':'time'} value={item||''} onChange={e=>onChange({...value,[key]:e.target.value})}/></Label>
    if(key==='outcome')return <Label key={key}>执行结果<NativeSelect value={item} onChange={e=>onChange({...value,[key]:e.target.value})}><option value="completed">完成</option><option value="partial">部分完成</option><option value="postponed">暂缓</option></NativeSelect></Label>
    if(!fieldLabels[key]||item&&typeof item==='object')return null
    const number=['duration_minutes','weekly_target','actual_minutes','remaining_minutes','hours'].includes(key)||typeof item==='number'
    const date=key==='deadline'
    return <Label key={key}>{fieldLabels[key]}{['summary','conclusion','next_steps','description','motivation','reason'].includes(key)?<Textarea aria-label={fieldLabels[key]} value={item||''} onChange={e=>onChange({...value,[key]:e.target.value})}/>:<Input type={date?'datetime-local':key==='due_date'?'date':number?'number':'text'} value={date?toDatetimeLocalValue(item):item??''} onChange={e=>onChange({...value,[key]:date?(e.target.value?toBackendDeadline(e.target.value):null):number?(e.target.value===''?null:Number(e.target.value)):e.target.value})}/>}</Label>
  })}</div>
}

export function ReviewFields({value,onChange,sidebar=false}){
  return <><Label>标题<Input required maxLength={160} value={value.title} onChange={e=>onChange({...value,title:e.target.value})}/></Label>{[['summary','回顾摘要'],['conclusion','我的结论'],['next_steps','下一步（可空）']].map(([key,label])=><Label key={key}>{label}<Textarea aria-label={label} rows={sidebar?(key==='summary'?6:4):undefined} maxLength={key==='next_steps'?4000:6000} value={value[key]||''} onChange={e=>onChange({...value,[key]:e.target.value})}/></Label>)}</>
}

function ReviewPeriod({value}){
  return <p className="review-draft-period"><time dateTime={value.start_date}>{value.start_date}</time><span>至</span><time dateTime={shiftDate(value.end_date,-1)}>{shiftDate(value.end_date,-1)}</time></p>
}

function ReviewReading({value,label='已保存的复盘内容'}){
  return <article className="review-draft-reading" aria-label={label}>
    <header><h3>{value.title}</h3><ReviewPeriod value={value}/></header>
    {[['summary','回顾摘要'],['conclusion','我的结论'],['next_steps','下一步']].map(([key,label])=><section key={key}><h4>{label}</h4><p className={!value[key]?'muted':undefined}>{value[key]||'未填写'}</p></section>)}
  </article>
}

export function DraftPreview({draft}){
  if(!draft)return null
  const content=draft.preview_content||draft.content
  if(draft.kind==='review_record')return <ReviewReading value={content} label="复盘草案预览"/>
  const sections={create_goal:'成长目标',update_goal:'成长目标',create_preference_rule:'安排偏好',update_preference_rule:'安排偏好',
    create_category:'任务类别',create_time_rule:'课程与保护时间',update_time_rule:'课程与保护时间',record_feedback:'执行反馈',work_timer:'计时记录'}
  return <section className="v2-readonly-summary draft-result-preview" aria-label={`${draftLabels[draft.kind]}预览`}>
    <h3>{draftLabels[draft.kind]} · 草案</h3>
    {(content?.operations||[]).map((op,index)=><article key={index}><h4>{sections[op.op]||'修改内容'}</h4><fieldset disabled className="[&_:disabled]:opacity-100"><Fields value={op}/></fieldset></article>)}
  </section>
}

export default function WorkspaceDraft({workspace,kind,id,onSaved,onClose,onPreview}){
  const confirmAction = useConfirmation()
  const [draft,setDraft]=useState(null),[value,setValue]=useState(null),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[remote,setRemote]=useState(null)
  const [readRetry,setReadRetry]=useState(0),[loading,setLoading]=useState(true)
  const [splittingIndex,setSplittingIndex]=useState(null)
  const current=useRef(null);current.current={draft,value,dirty}
  useLayoutEffect(()=>{if(draft&&value)onPreview?.({...draft,preview_content:value},{kind,id})},[draft,value,onPreview,kind,id])
  useEffect(()=>()=>onPreview?.(null,{kind,id}),[onPreview,kind,id])
  const recovery=useEditRecovery({workspace,resource:`shared-draft:${kind}:${id}`,base:draft?.version,value:{value},dirty,
    restore:saved=>{setValue(saved.value);setDirty(true)}})
  function adopt(next){const content=kind==='breakdown'?editableContent(next.content):next.content;current.current={draft:next,value:content,dirty:false};setDraft(next);setValue(content);setDirty(false);setRemote(null)}
  function handleFailure(cause) {
    setError(cause.message)
    const versionConflict=cause.code?.endsWith('VERSION_CONFLICT')
    if(!versionConflict&&!['STALE_DRAFT','STALE_CANDIDATE','REVIEW_FACTS_CHANGED'].includes(cause.code))return
    getWorkspaceDraft(kind,current.current?.draft?.id||id).then(async next=>{
      if(next.status==='superseded'&&next.replacement_id)next=await getWorkspaceDraft(kind,next.replacement_id)
      if(next.version!==current.current?.draft?.version)setRemote(next)
    }).catch(()=>{})
  }
  useEffect(()=>{let alive=true;setLoading(true);setError('');getWorkspaceDraft(kind,id).then(async next=>{
    // Generic planning edits create an immutable replacement. Refreshing its
    // original link must reopen the server's latest version, not a dead card.
    if(next.status==='superseded'&&next.replacement_id)next=await getWorkspaceDraft(kind,next.replacement_id)
    if(alive)adopt(next)
  }).catch(cause=>{if(alive)setError(cause.message)}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[kind,id,readRetry])
  useEffect(()=>{
    let valid=true
    const read=()=>{const state=current.current;if(!state?.draft)return;getWorkspaceDraft(kind,state.draft.id).then(async next=>{
      if(next.status==='superseded'&&next.replacement_id)next=await getWorkspaceDraft(kind,next.replacement_id)
      if(!valid||next.version===current.current?.draft?.version)return
      if(current.current?.dirty)setRemote(next);else adopt(next)
    }).catch(cause=>{if(valid)setError(cause.message)})}
    window.addEventListener('sga-drafts-changed',read)
    return()=>{valid=false;window.removeEventListener('sga-drafts-changed',read)}
  },[kind,id])
  async function save(){
    const state=current.current;if(!state?.draft)throw Error('草案尚未读取完成。')
    if(!state.dirty&&!state.draft.requires_recalculation)return state.draft
    try{
      const payload=kind==='breakdown'?breakdownPayload(state.value):kind==='planning'?planningDraftPayload(state.draft,state.value):state.value
      const next=await editWorkspaceDraft(kind,state.draft.id,state.draft.version,payload)
      adopt(next);draftEvent();return next
    }catch(cause){handleFailure(cause);throw cause}
  }
  useEffect(()=>registerEditor(`shared:${kind}:${id}`,{dirty:()=>current.current?.dirty||false,save,
    reference:async()=>{if(!current.current?.draft)return null;const latest=await getWorkspaceDraft(kind,current.current.draft.id);return {kind,id:latest.id,version:latest.version}}}),[kind,id])
  function change(next){setValue(next);setDirty(true);setError('')}
  async function split(index){
    if(busy)return
    const state=current.current
    const task=planningTaskFields(state.draft,state.value)[index]
    setBusy(true);setSplittingIndex(index);setError('')
    try{
      if(!Number.isInteger(task.segments)||task.segments<2||task.segments>8)throw Error('分段数量需为2到8的整数。')
      if(!Number.isInteger(task.duration_minutes)||task.duration_minutes<5||task.duration_minutes%5)throw Error('请填写5分钟整数倍的预计分钟。')
      if(task.duration_minutes<task.segments*5)throw Error('每段至少需要5分钟，请减少分段数量。')
      const next=await splitWorkspaceDraft(state.draft.id,state.draft.version,state.value,task.ref)
      adopt(next);draftEvent()
    }catch(cause){handleFailure(cause)}finally{setBusy(false);setSplittingIndex(null)}
  }
  const editable=editableDraft(draft)
  const review=kind==='review_record',savedReview=review&&draft?.status==='applied'
  async function useCompletionDeadline(){
    if(busy)return;setBusy(true);setError('')
    try{
      const saved=await save(),latest=await getWorkspaceDraft(kind,saved.id)
      if(latest.version!==saved.version){setRemote(latest);throw Error('草案已改变，请先比较最新安排，再选择截止时间。')}
      const deadline=previewCompletionDeadline(latest)
      if(!deadline)throw Error('当前没有可采用的候选时段，请先调整安排。')
      change({...saved.content,schedule:{...saved.content.schedule,deadline}})
    }catch(cause){setError(cause.message)}finally{setBusy(false)}
  }
  async function act(action){
    if(busy)return
    if(action==='discard'&&dirty&&!await confirmAction('放弃这份草案及未保存的修改？'))return
    setBusy(true);setError('')
    try{
      // Explicit abandonment never requires invalid local fields to be saved.
      const saved=action==='discard'?current.current.draft:await save()
      const latest=await getWorkspaceDraft(kind,saved.id)
      if(latest.version!==saved.version){setRemote(latest);throw Error('草案已改变，输入保留，请比较后重新读取。')}
      if(action==='confirm'&&(latest.status!=='ready'||latest.unresolved?.length)){
        adopt(latest)
        if(kind==='planning'){setError('');return}
        throw Error(latest.unresolved?.join(' ')||'当前安排仍有冲突或信息未补齐，请修改后再确认。')
      }
      const next=await actWorkspaceDraft(kind,saved.id,saved.version,action)
      adopt(next);draftEvent();if(action==='confirm')onSaved?.()
    }catch(cause){handleFailure(cause)}finally{setBusy(false)}
  }
  const saveButton=<Button className="button secondary" disabled={busy||!dirty&&!draft?.requires_recalculation||!editable} onClick={()=>{setBusy(true);save().catch(()=>{}).finally(()=>setBusy(false))}}>保存草案编辑</Button>
  const confirmButton=<Button className="button primary" disabled={busy||!canConfirmDraft(draft,dirty)} onClick={()=>act('confirm')}>{kind==='planning'?'确认采用方案':'确认正式保存'}</Button>
  return <section className={`workspace-draft panel${review?' review-draft':''}`} aria-label="共享草案编辑器" data-status={draft?.status}><div className="section-heading"><h2>{draftLabels[kind]}{review?<Badge className="review-draft-status" role="status">{statusLabels[draft?.status]||'读取中'}</Badge>:(kind!=='planning'||draft?.status!=='conflict')&&<> · {statusLabels[draft?.status]||'读取中'}</>}</h2><Button className="button subtle" disabled={busy} onClick={()=>{if(dirty)setError('有未保存修改，请保存或保留缓存后再关闭。');else onClose?.()}}>关闭草案</Button></div>
    {error&&<Alert variant="destructive" role="alert">{error}</Alert>}<EditRecovery recovery={recovery} label="共享草案编辑"/>
    {kind==='planning'&&!dirty&&<PlanningProblems draft={draft}/>}
    {remote&&<details open className="recovery-note"><summary>服务端最新内容（本地编辑仍保留）</summary>{kind==='review_record'?<ReviewReading value={remote.content}/>:<fieldset disabled>{kind==='planning'?<PlanningFields draft={remote}/>:<>{(remote.content.operations||[]).map((op,index)=><Fields key={index} value={op}/>)}</>}</fieldset>}<Button onClick={async()=>{if(await confirmAction('用服务端版本替换编辑器？本地内容请先保留对照。')){adopt(remote);setError('')}}}>读取服务器版本</Button></details>}
    {draft&&value?savedReview?<>
      <ReviewReading value={value}/>
      {draft.notices?.length>0&&<details className="review-draft-notices"><summary>整理说明</summary><PreviewDetails draft={draft}/></details>}
      <p className="review-draft-receipt">可在复盘页的记录中查看；任务和日程不受影响。</p>
    </>:<>{!review&&kind!=='planning'&&<p className="helper">{draft.summary} · {statusLabels[draft.status]||draft.status} {dirty?'· 有未保存修改':''}</p>}{review&&dirty&&<p className="review-draft-unsaved" role="status">有未保存修改</p>}
      <PreviewDetails draft={draft}/>
      {editable&&value.schedule&&!value.schedule.deadline&&<div className="draft-confirm-help">{!draft.problems?.some(problem=>problem.code==='DEADLINE_REQUIRED')&&<p>确认前请填写截止时间，也可以明确选择以本次安排结束时间为截止。</p>}<Button className="button secondary" disabled={busy||!previewCompletionDeadline(draft)} onClick={useCompletionDeadline}>以安排结束时间作为截止</Button></div>}
      <fieldset disabled={busy||!editable} className="draft-editor-fields">
      {kind==='breakdown'?<BreakdownEditor content={value} expected={value.children.reduce((sum,c)=>sum+Number(c.duration_minutes||0),0)} onChange={change}/>:
        kind==='planning'?<PlanningFields draft={draft} content={value} onChange={change} onSplit={split} splittingIndex={splittingIndex}/>:
        kind==='review_record'?<><ReviewPeriod value={value}/><ReviewFields value={value} onChange={change} sidebar/></>:
        <>{(value.operations||[]).map((op,index)=>{
          const onChange=next=>change({...value,operations:value.operations.map((old,i)=>i===index?next:old)})
          return <section className="draft-operation" key={index}><h3>{operationLabels[op.op] || '资料修改建议'}</h3><Fields value={op} onChange={onChange}/></section>
        })}</>}
      </fieldset><div className={`button-row${review?' review-draft-actions':''}`}>{review&&confirmButton}{saveButton}{!review&&confirmButton}<Button className="button subtle" disabled={busy||draft.status==='applied'} onClick={()=>act('discard')}>放弃草案</Button></div>
      {draft.receipt&&<p role="status">保存结果：已正式保存。{kind==='planning'?'任务与日程已刷新。':kind==='review_record'?'可在复盘记录中查看。':'可到对应页面查看。'}</p>}{kind!=='planning'&&<p className="helper">{draft.status==='applied'?'这份草案已经保存。如需调整，请基于最新正式记录生成新的草案。':review?'保存编辑仅暂存草案，确认后才存入复盘记录，不改变任务或日程。':'保存编辑仍是草案；只有确认后才写入正式业务。旧卡片与冲突版本无法直接执行。'}</p>}
    </>:loading?<p role="status">正在读取草案…</p>:<Button className="button secondary" onClick={()=>setReadRetry(v=>v+1)}>重试读取草案</Button>}
  </section>
}

export function DraftCard({reference,active,onOpen,workspace,expanded=false,onClose,onSaved,onPreview}){
  const [current,setCurrent]=useState(null),[error,setError]=useState('')
  useEffect(()=>{
    if(!active)return
    let alive=true
    const read=()=>getWorkspaceDraft(reference.kind,reference.id).then(async next=>{
      if(next.status==='superseded'&&next.replacement_id)next=await getWorkspaceDraft(reference.kind,next.replacement_id)
      if(alive)setCurrent(next)
    }).catch(cause=>{if(alive)setError(cause.message)})
    read();window.addEventListener('sga-drafts-changed',read);return()=>{alive=false;window.removeEventListener('sga-drafts-changed',read)}
  },[reference.kind,reference.id,active])
  return <section className="workspace-draft" data-draft-kind={reference.kind} data-draft-id={reference.id}><strong>{draftLabels[reference.kind]}{(reference.kind!=='planning'||current?.status!=='conflict')&&<> · {statusLabels[current?.status]||'读取中'}</>}</strong>{reference.kind!=='planning'&&<p>{current?.summary||reference.summary}</p>}{error&&<p role="alert">{error}</p>}{expanded&&workspace?<WorkspaceDraft workspace={workspace} kind={reference.kind} id={reference.id} onSaved={onSaved} onClose={onClose} onPreview={active?onPreview:undefined}/>:<><PreviewDetails draft={current}/>{current&&<Button className="button secondary" onClick={()=>onOpen({page:reference.kind==='review_record'?'review':reference.kind==='feedback'?'review':reference.kind==='profile'?'profile':'schedule',kind:reference.kind,id:current.replacement_id||current.id})}>查看最新草案</Button>}</>}</section>
}
