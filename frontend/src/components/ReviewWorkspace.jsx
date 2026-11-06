import { Alert } from '../codex/ui/controls.js'
import { Tabs, TabsList, TabsTrigger } from '../codex/ui/tabs.jsx'
import { useConfirmation } from '../codex/ui/confirmation-provider.jsx'
import { Button, Input, NativeSelect, Label } from '../codex/ui/controls.js'
import {useEffect,useRef,useState} from 'react'
import {getReviewFacts,getReviewRecords,getReviewRecord,saveReviewRecord} from '../api.js'
import {reviewRange,shiftDate} from '../calendar.js'
import {ReviewFields} from './WorkspaceDraft.jsx'
import EditRecovery,{useEditRecovery} from './EditRecovery.jsx'
import {recordedTime} from '../workbench.js'
import ReviewDashboard from '../codex/ReviewDashboard.jsx'
import { RotateCw, NotebookPen } from 'lucide-react'

export default function ReviewWorkspace({workspace,today,active,refreshVersion,onDiscuss,onSaved,onOpenTask,resource,analyticsContent,onAnalyticsOpen}){
  const confirmAction = useConfirmation()
  const [tab,setTab]=useState('facts'),[period,setPeriod]=useState('week'),[date,setDate]=useState(today),[facts,setFacts]=useState(null)
  const [rows,setRows]=useState([]),[next,setNext]=useState(null),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[recordPeriod,setRecordPeriod]=useState(''),[recordStart,setRecordStart]=useState(''),[recordEnd,setRecordEnd]=useState('')
  const [editor,setEditor]=useState(null),[baseline,setBaseline]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[changed,setChanged]=useState(0),[remote,setRemote]=useState(null)
  const requestId=useRef(null),generation=useRef(0)
  const [factsLoading,setFactsLoading]=useState(true),[factsError,setFactsError]=useState(''),[listLoading,setListLoading]=useState(true),[listError,setListError]=useState(''),[moreLoading,setMoreLoading]=useState(false),listGeneration=useRef(0)
  const [start,end]=reviewRange(date,period)
  const [editorId,setEditorId]=useState(null)
  const selectionRecovery=useEditRecovery({workspace,resource:'review-editor-selection',base:today?'review-editor-v1':undefined,value:{id:editorId},dirty:Boolean(editorId),automatic:true,restore:value=>{if(Number.isSafeInteger(value.id)&&value.id>0)setEditorId(value.id)}})
  useEffect(()=>{
    if(!editorId)return
    let valid=true
    getReviewRecord(editorId).then(row=>{if(valid){setBaseline({id:row.id,version:row.version});setEditor(row)}}).catch(cause=>{if(valid)setError(cause.message)})
    return()=>{valid=false}
  },[editorId])
  const uiRecovery=useEditRecovery({workspace,resource:'review-view',base:today?'review-view-v1':undefined,value:{tab,period,date},dirty:true,automatic:true,restore:value=>{if(['facts','trends','records'].includes(value.tab)){setTab(value.tab);if(value.tab==='trends')onAnalyticsOpen?.()};if(['day','week','month'].includes(value.period))setPeriod(value.period);if(/^20\d\d-\d\d-\d\d$/.test(value.date))setDate(value.date)}})
  const recovery=useEditRecovery({workspace,resource:`review-record-editor:${editor?.id||'new'}`,base:editor?.id?(baseline?JSON.stringify(baseline):undefined):facts?'manual-new':undefined,
    value:{editor},dirty:Boolean(editor),restore:saved=>setEditor(saved.editor)})
  useEffect(()=>{
    if(!active||tab!=='facts')return
    const token=++generation.current;setFactsError('');setFactsLoading(true);setFacts(null)
    getReviewFacts(start,end).then(value=>{if(token===generation.current)setFacts(value)}).catch(cause=>{if(token===generation.current)setFactsError(cause.message)}).finally(()=>{if(token===generation.current)setFactsLoading(false)})
    return()=>{generation.current++}
  },[active,tab,start,end,refreshVersion,changed])
  useEffect(()=>{
    if(!active||tab!=='records')return
    const token=++listGeneration.current;setListLoading(true);setListError('');setMoreLoading(false)
    getReviewRecords({q:search,period:recordPeriod,start:recordStart,end:recordEnd}).then(value=>{if(token===listGeneration.current){setRows(value.items);setNext(value.next_offset)}}).catch(cause=>{if(token===listGeneration.current)setListError(cause.message)}).finally(()=>{if(token===listGeneration.current)setListLoading(false)})
    return()=>{listGeneration.current++}
  },[active,tab,search,recordPeriod,recordStart,recordEnd,changed,refreshVersion])
  function blank(){
    if(editor){setError('当前编辑尚未关闭，请先保存或保留本地内容。');return}
    setBaseline('manual-new');requestId.current=crypto.randomUUID()
    setEditor({period,start_date:start,end_date:end,title:'',summary:'',conclusion:'',next_steps:'',requestId:requestId.current});setRemote(null)
  }
  async function more(){
    if(moreLoading||listLoading||next===null)return
    const token=listGeneration.current;setMoreLoading(true);setListError('')
    try{const page=await getReviewRecords({q:search,period:recordPeriod,start:recordStart,end:recordEnd,offset:next});if(token===listGeneration.current){setRows(old=>[...old,...page.items]);setNext(page.next_offset)}}
    catch(cause){if(token===listGeneration.current)setListError(cause.message)}finally{if(token===listGeneration.current)setMoreLoading(false)}
  }
  async function open(id){
    if(editor){setError('当前有编辑内容，请先处理再打开另一条记录。');return}
    try{const row=await getReviewRecord(id);setBaseline({id:row.id,version:row.version});setEditor(row);setEditorId(id);setRemote(null)}catch(cause){setError(cause.message)}
  }
  async function save(event){
    event.preventDefault();if(busy)return;setBusy(true);setError('')
    const content=Object.fromEntries(['period','start_date','end_date','title','summary','conclusion','next_steps'].map(k=>[k,editor[k]]))
    try{
      const payload=editor.id?{...content,expected_version:baseline.version}:{...content,client_request_id:editor.requestId||(requestId.current||=(crypto.randomUUID()))}
      await saveReviewRecord(payload,editor.id);setEditor(null);setEditorId(null);setBaseline(null);requestId.current=null;setChanged(v=>v+1);onSaved?.();setTab('records')
    }catch(cause){setError(cause.message);if(editor.id)getReviewRecord(editor.id).then(setRemote).catch(()=>{})}finally{setBusy(false)}
  }
  const monthStep=direction=>{const value=new Date(date+'T12:00:00Z');value.setUTCDate(1);value.setUTCMonth(value.getUTCMonth()+direction);return value.toISOString().slice(0,10)}
  return <Tabs asChild value={tab} onValueChange={value=>{setTab(value);if(value==='trends')onAnalyticsOpen?.()}}><section className="review-workspace" aria-label="回顾与复盘记录">
    <EditRecovery recovery={selectionRecovery} label="记录选择"/><EditRecovery recovery={uiRecovery} label="回顾界面"/><EditRecovery recovery={recovery} label="复盘记录编辑"/>
    <header className="review-page-heading"><div><h2>复盘</h2><p>回看每一份投入，了解自己的成长节奏。</p></div><div className="review-page-actions"><Button className="button subtle" aria-label="刷新回顾数据" onClick={()=>setChanged(v=>v+1)}><RotateCw size={15} aria-hidden="true"/>刷新</Button><Button className="button secondary" onClick={blank}><NotebookPen size={15} aria-hidden="true"/>自己写几句</Button></div></header>
    <TabsList aria-label="复盘内容">{[['facts','回顾'],['trends','成长趋势'],['records','复盘记录']].map(([key,label])=><TabsTrigger key={key} value={key} id={'review-tab-'+key} aria-controls={'review-panel-'+key}>{label}</TabsTrigger>)}</TabsList>
    {error&&<Alert variant="destructive" role="alert">{error}</Alert>}
    <div id="review-panel-facts" role="tabpanel" aria-labelledby="review-tab-facts" hidden={tab!=='facts'} inert={tab!=='facts'}>
      <div className="calendar-toolbar review-range-toolbar"><div role="group" aria-label="回顾周期">{[['day','日'],['week','周'],['month','月']].map(([key,label])=><Button className="button subtle" aria-pressed={period===key} key={key} onClick={()=>{setPeriod(key)}}>{label}</Button>)}</div>
      <div className="review-date-navigation"><Button className="button subtle" aria-label="回顾上一段" onClick={()=>setDate(period==='month'?monthStep(-1):shiftDate(date,period==='week'?-7:-1))}>‹</Button><Label><span className="visually-hidden">回顾日期</span><Input type="date" value={date} min="2000-01-01" max="2100-12-31" onChange={e=>{if(e.target.value)setDate(e.target.value)}}/></Label><Button className="button subtle" aria-label="回顾下一段" onClick={()=>setDate(period==='month'?monthStep(1):shiftDate(date,period==='week'?7:1))}>›</Button></div><Button className="button subtle" onClick={()=>setDate(today)}>回到当前</Button></div>
      <div className="review-range-caption"><strong>{start} 至 {shiftDate(end,-1)}</strong><span>北京时间 · 仅汇总有效记录</span></div>
      {factsError?<Alert variant="destructive" role="alert">{factsError}<Button className="button subtle" onClick={()=>setChanged(v=>v+1)}>重试回顾事实</Button></Alert>:facts?<ReviewDashboard key={`${start}:${end}:${facts.revision}:${changed}`} facts={facts} onOpenTask={onOpenTask} active={active&&tab==='facts'}/>:factsLoading&&<div className="review-data-card" role="status">正在读取事实…</div>}
      <div className="review-secondary-actions"><Button className="button subtle" onClick={()=>onDiscuss?.({start,end,period})}>和 AI 复盘</Button></div>
    </div>
    <div id="review-panel-trends" role="tabpanel" aria-labelledby="review-tab-trends" hidden={tab!=='trends'} inert={tab!=='trends'}>{tab==='trends'&&analyticsContent}</div>
    <div id="review-panel-records" role="tabpanel" aria-labelledby="review-tab-records" hidden={tab!=='records'} inert={tab!=='records'}>
      <form className="calendar-toolbar" onSubmit={e=>{e.preventDefault();setSearch(query)}}><Label>搜索复盘记录<Input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></Label><Button className="button subtle">搜索记录</Button><Label>记录周期<NativeSelect value={recordPeriod} onChange={e=>setRecordPeriod(e.target.value)}><option value="">全部</option><option value="day">日</option><option value="week">周</option><option value="month">月</option></NativeSelect></Label><Label>记录范围起<Input type="date" value={recordStart} onChange={e=>setRecordStart(e.target.value)}/></Label><Label>记录范围止<Input type="date" value={recordEnd} onChange={e=>setRecordEnd(e.target.value)}/></Label></form>
      {listLoading?<p role="status">正在读取复盘记录…</p>:listError?<Alert variant="destructive" role="alert">{listError}<Button className="button subtle" onClick={()=>setChanged(v=>v+1)}>重试复盘记录</Button></Alert>:!rows.length&&<p className="growth-empty">尚无符合条件的正式复盘记录。</p>}
      {!listLoading&&!listError&&rows.map(row=><article className="review-record" key={row.id}><h3>{row.title}</h3><p>{row.start_date} 至 {shiftDate(row.end_date,-1)}</p><p>{row.summary}</p><Button className="button secondary" onClick={()=>open(row.id)}>查看或编辑记录</Button></article>)}
      {!listLoading&&!listError&&next!==null&&<Button className="button subtle" disabled={moreLoading} onClick={more}>{moreLoading?'正在读取…':'更多复盘记录'}</Button>}
    </div>
    {editor&&<form className="review-record-editor growth-form" onSubmit={save} aria-label="复盘记录编辑器"><h3>{editor.id?'编辑复盘记录':'自己写几句'}</h3><p>{editor.start_date} 至 {editor.end_date}</p><ReviewFields value={editor} onChange={setEditor}/>
      {remote&&<details open className="recovery-note"><summary>最新记录对照</summary><h4>{remote.title}</h4><p>{remote.summary}</p><p>{remote.conclusion}</p><p>{remote.next_steps}</p><Button type="button" onClick={async()=>{if(await confirmAction('用服务器最新内容替换编辑器？请先保留需要的本地文字。')){setBaseline({id:remote.id,version:remote.version});setEditor(remote);setRemote(null)}}}>载入最新记录</Button></details>}
      {editor.facts&&<details><summary>保存时的事实与来源</summary><p>已确认完成 {editor.facts.completed_count} 项；{recordedTime(editor.facts.known_minutes,editor.facts.unknown_count,editor.facts.feedback_ids?.length)}。</p>{editor.sources?.conversation_id&&<p>此记录关联已保存的讨论原文。</p>}{editor.history?.map((entry,index)=><details key={index}><summary>第{index+1}次修改</summary><p>{entry.title}</p><p>{entry.summary}</p><p>{entry.conclusion}</p></details>)}</details>}
      <div className="button-row"><Button className="button primary" disabled={busy}>明确保存复盘记录</Button><Button className="button subtle" type="button" onClick={async()=>{if(await confirmAction('放弃本次未提交编辑？')){setEditor(null);setEditorId(null);setBaseline(null)}}}>放弃本次编辑</Button></div><p className="helper">保存复盘只保存文字和当时事实，不改变任务或日程。未提交内容可从本标签页缓存恢复。</p>
    </form>}
  </section></Tabs>
}
