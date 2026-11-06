import { Button } from './codex/ui/controls.js'
import { useEffect, useReducer, useRef, useState,lazy } from 'react'
import { getAssistantSettings } from './api.js'
import AssistantPage from './pages/AssistantPage.jsx'
import SchedulePage from './pages/SchedulePage.jsx'
const ReviewPage=lazy(()=>import('./pages/GoalsGrowthPage.jsx'))
const MyProfilePage=lazy(()=>import('./pages/MyProfilePage.jsx'))
import WorkspaceShell from './components/WorkspaceShell.jsx'
import ConversationManager from './components/ConversationManager.jsx'
import WorkspaceDraft from './components/WorkspaceDraft.jsx'
import { hasUnsavedDraft } from './draftCoordination.js'
import EditRecovery, { useEditRecovery } from './components/EditRecovery.jsx'
import { initialWorkbench, readSplitRatio, splitPreferenceKey, toolPlacement, workbenchPanel, workbenchReducer, workspaceClock } from './workbench.js'

export default function App() {
  const [state, dispatch] = useReducer(workbenchReducer, initialWorkbench, initial => {
    try { return { ...initial, splitRatio: readSplitRatio(window.localStorage) } } catch { return initial }
  })
  const [settings, setSettings] = useState(null)
  const [clock, setClock] = useState('')
  const [settingsError,setSettingsError]=useState('')
  const [versions, setVersions] = useState({ planning: 0, tasks: 0, review: 0, profile: 0 })
  const [adjustment, setAdjustment] = useState(null)
  const [resource, setResource] = useState(null)
  const [draftResource,setDraftResource]=useState(null)
  const chatEntry=useRef(null)
  const draftReturnFocus=useRef(null)
  const dataChanged = source => setVersions(current=>Object.fromEntries(Object.entries(current).map(([key,value])=>[key,value+(key===source?0:1)])))
  function openResource(link) {
    if (!['schedule','review','profile'].includes(link?.page)) return
    if (link.kind==='task' && Number.isSafeInteger(link.id)) {
      chatEntry.current?.(`请查询任务 #${link.id} 的详情、进度和计时情况，帮我处理后续执行。`)
      return
    }
    if (['planning','breakdown','profile','feedback','review_record'].includes(link.kind) && Number.isSafeInteger(link.id)) {
      if ((!draftResource || draftResource.kind!==link.kind || draftResource.id!==link.id) && hasUnsavedDraft()) {
        window.alert('当前草案有未保存编辑，请先保存或修正后再打开另一份草案。'); return
      }
      draftReturnFocus.current=document.activeElement
      setDraftResource(link)
      dispatch({type:'navigate',page:'home'})
      requestAnimationFrame(()=>document.getElementById('v2-draft-preview')?.focus())
      return
    }
    dispatch({type:'navigate',page:link.page})
    setResource({...link, requestKey:crypto.randomUUID()})
    requestAnimationFrame(()=>{
      const page=document.getElementById('v2-page-'+link.page)
      page?.focus()
      if(link.kind==='task'&&Number.isSafeInteger(link.id)) {
        const details=page?.querySelector('.task-memory'); if(details)details.open=true
        page?.querySelector(`[data-resource-task="${link.id}"]`)?.scrollIntoView({block:'center'})
      }
    })
  }
  function closeDraft(){
    setDraftResource(null)
    requestAnimationFrame(()=>{
      const target=draftReturnFocus.current
      if(target?.isConnected&&!target.closest('[hidden], [inert]'))target.focus()
      else document.getElementById('v2-chat')?.focus()
    })
  }
  const layoutRecovery = useEditRecovery({ workspace: settings?.workspace_id, resource: 'layout', base: settings ? 'layout-v1' : undefined,
    value: { navigation: state.navigation, auxiliaryPage: state.auxiliaryPage, panel: state.panel, conversations: state.conversations, mobile: state.mobile }, dirty: true,
    automatic: true, restore: value => dispatch({ type: 'restore', value }) })
  const draftRecovery=useEditRecovery({workspace:settings?.workspace_id,resource:'shared-draft-selection',base:settings?'draft-selection-v1':undefined,
    value:{draftResource},dirty:Boolean(draftResource),automatic:true,restore:value=>{
      const link=value.draftResource
      if(link&&['planning','breakdown','feedback','profile','review_record'].includes(link.kind)&&Number.isSafeInteger(link.id)&&['schedule','review','profile'].includes(link.page))setDraftResource(link)
    }})
  useEffect(() => { getAssistantSettings().then(setSettings).catch(cause => setSettingsError(cause.message)) }, [])
  useEffect(() => {
    let timer
    const tick = () => {
      clearTimeout(timer)
      const now = Date.now()
      setClock(workspaceClock({ now: new Date(now).toISOString() }))
      timer = setTimeout(tick, 60000 - now % 60000)
    }
    tick()
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => { clearTimeout(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick) }
  }, [])
  useEffect(() => {
    try { localStorage.setItem(splitPreferenceKey, String(state.splitRatio)) } catch { /* Optional device preference; layout remains usable. */ }
  }, [state.splitRatio])
  const toolActive = page => toolPlacement(state, page) === 'primary' || (state.navigation === 'home' && state.auxiliaryPage === page && workbenchPanel(state) !== 'collapsed')
  function requestAdjustment(next) {
    chatEntry.current?.(`请调整任务 #${next.taskId}（${next.title}）的安排${next.durationMinutes?`，预计时长改为${next.durationMinutes}分钟`:''}，先给我草案。`)
  }
  if (!settings) return <p role="status">{settingsError||'正在读取工作区设置…'}{settingsError&&<Button onClick={()=>location.reload()}>重试读取工作区</Button>}</p>
  return <ConversationManager today={settings.now.slice(0,10)} key={settings?.workspace_id || 'loading'} active={state.navigation==='home'} onNavigate={openResource} onBusinessSaved={()=>dataChanged()} onAdjustTask={requestAdjustment} workspace={settings?.workspace_id} onOpen={() => dispatch({ type: 'navigate', page: 'home' })}>{({ sidebar, chat: conversationChat, planning, openPlanning, openBusiness, openConversation, discussReview, discussRequest }) => { chatEntry.current=discussRequest; return <SchedulePage settings={settings} active={state.navigation==='schedule'} onDiscussRules={()=>discussRequest('请查询我的课程与保护时间规则，我想调整这些固定时间。')} auxiliaryActive={state.navigation==='home'&&state.auxiliaryPage==='schedule'&&workbenchPanel(state)!=='collapsed'} refreshVersion={versions.planning} onDataChanged={()=>dataChanged()} onOpenTask={id=>openResource({page:'schedule',kind:'task',id})} onOpenDraft={id=>openResource({page:'schedule',kind:'planning',id})}
    renderWorkbench={({ children, auxiliarySchedule }) => <WorkspaceShell state={state} dispatch={dispatch} chatNote={planning?'规划操作沿用原草案与确认流程。':null} conversationContent={<><EditRecovery recovery={layoutRecovery} label="界面状态" /><EditRecovery recovery={draftRecovery} label="草案选择" />{sidebar}</>} chat={<><div className="v2-chat-surface" hidden={!planning} inert={!planning}><AssistantPage initialSettings={settings} enabled={planning||Boolean(adjustment)} active={planning&&state.navigation==='home'} observeChat={planning&&state.navigation==='home'} recoveryWorkspace={settings.workspace_id} requestedAction={adjustment} onActionHandled={()=>setAdjustment(null)} refreshVersion={versions.planning} onPlanConfirmed={()=>dataChanged()} onManagePreferences={()=>dispatch({type:'navigate',page:'profile'})} onFocusChat={openPlanning}/></div><div className="v2-chat-surface" hidden={planning} inert={planning}>{conversationChat}</div></>} auxiliarySchedule={auxiliarySchedule}
      clock={clock} draftPage={draftResource?.page} draftPanel={draftResource&&<WorkspaceDraft key={`${draftResource.kind}:${draftResource.id}`} workspace={settings.workspace_id} kind={draftResource.kind} id={draftResource.id} onSaved={()=>dataChanged()} onClose={closeDraft}/>}
      review={state.visited.includes('review') && <ReviewPage primaryActive={state.navigation==='review'} workspace={settings.workspace_id} today={settings.now.slice(0,10)} onDiscuss={discussReview} resource={resource} onOpenTask={id=>openResource({page:'schedule',kind:'task',id})} onReturnChat={resource?.conversationId?()=>openConversation(resource.conversationId,resource.messageId):undefined} onDataChanged={()=>dataChanged('review')} onBusinessChat={()=>openBusiness('review')} active={toolActive('review')} refreshVersion={versions.review} onAdjustTask={requestAdjustment} />}
      profile={state.visited.includes('profile') && <MyProfilePage resource={resource} onOpenConversation={openConversation} primaryActive={state.navigation==='profile'} onReturnChat={resource?.conversationId?()=>openConversation(resource.conversationId,resource.messageId):undefined} onDataChanged={()=>dataChanged('profile')} onBusinessChat={()=>openBusiness('profile')} recoveryWorkspace={settings?.workspace_id} active={toolActive('profile')} refreshVersion={versions.profile} />}>
      {resource?.conversationId&&<Button className="button subtle" onClick={()=>openConversation(resource.conversationId,resource.messageId)}>返回相关对话</Button>}{children}
    </WorkspaceShell>} />}}</ConversationManager>
}
