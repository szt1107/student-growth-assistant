import { Button } from '../codex/ui/controls.js'
import ClockBadge from '../codex/ClockBadge.jsx'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../codex/ui/tooltip.jsx'
import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, Suspense } from 'react'
import { defaultSplitRatio, renderedSplitRatio, splitBounds, toolPlacement, workbenchPanel, workbenchVisibility, workspacePages } from '../workbench.js'

const labels = { home: '首页', schedule: '日程', review: '复盘', profile: '档案' }
const navigationIcons = {
  home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9M9 21v-7h6v7"/></>,
  schedule: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M7 15h2M13 15h4"/></>,
  review: <><path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6"/><path d="M12 7v5l3 2"/></>,
  profile: <><circle cx="12" cy="7" r="3.5"/><path d="M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/></>,
}

// Full pages stay in the primary area. Shared draft previews live in the auxiliary pane.
export default function WorkspaceShell({ state, dispatch, chat, children, review, profile, clock, conversationContent, auxiliarySchedule, draftPanel, draftPage, chatNote = null }) {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches)
  const [gridWidth, setGridWidth] = useState(1440)
  const [auxiliaryTarget, setAuxiliaryTarget] = useState(null)
  const root = useRef(null), grid = useRef(null), lastFocus = useRef(null), drag = useRef(null)
  const panel = state.navigation === 'home' ? workbenchPanel(state) : 'collapsed'
  const visible = workbenchVisibility(state, narrow)
  const home = state.navigation === 'home'
  const listWidth = visible.conversations ? 192 : 0
  const available = Math.max(680, gridWidth - 60 - listWidth - 8)
  const ratio = renderedSplitRatio(state.splitRatio, available)
  // Flex factors below 1 can leave unallocated grid space when the other
  // track freezes at its minimum. Scale both weights equally to consume it.
  const primaryWeight = ratio * 100, auxiliaryWeight = (1 - ratio) * 100
  const bounds = splitBounds(available)
  const resizable = home && !narrow && panel === 'normal'
  const controls = 'v2-auxiliary-shared'

  useEffect(()=>{
    const viewport=window.visualViewport
    const update=()=>{
      const height=viewport?.height||window.innerHeight
      root.current?.style.setProperty('--sga-viewport-height',height+'px')
      const editing=document.activeElement?.matches('textarea,input,select')
      root.current?.toggleAttribute('data-keyboard',Boolean(editing&&window.innerHeight-height>120))
      if(editing&&height<window.innerHeight-120)requestAnimationFrame(()=>document.activeElement?.scrollIntoView({block:'nearest'}))
    }
    update();viewport?.addEventListener('resize',update);window.addEventListener('resize',update)
    return()=>{viewport?.removeEventListener('resize',update);window.removeEventListener('resize',update)}
  },[])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)')
    const change = () => setNarrow(media.matches)
    media.addEventListener('change', change)
    change()
    return () => media.removeEventListener('change', change)
  }, [])
  useLayoutEffect(() => {
    const measure = () => setGridWidth(grid.current.clientWidth)
    const observer = new ResizeObserver(measure)
    observer.observe(grid.current)
    measure()
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    const focused = root.current?.contains(document.activeElement) ? document.activeElement : lastFocus.current
    if (!root.current?.contains(focused) || !focused.closest('[hidden], [inert]')) return
    const target = narrow ? `[data-mobile="${state.mobile}"]` : home ? '#v2-chat' : '#v2-page-' + state.navigation
    root.current.querySelector(target)?.focus()
  }, [state, narrow])
  useEffect(() => { if (!resizable) drag.current = null }, [resizable])

  function navigate(page) {
    dispatch({ type: 'navigate', page })
    requestAnimationFrame(() => root.current?.querySelector(page === 'home' ? '#v2-chat' : '#v2-page-' + page)?.focus())
  }
  function changePanel(value, focusPanel = true) {
    dispatch({ type: 'panel', value })
    if (!focusPanel) return
    requestAnimationFrame(() => root.current?.querySelector(narrow ? `[data-mobile="${value === 'collapsed' ? 'primary' : 'auxiliary'}"]` : value === 'collapsed' ? '#v2-toggle-workspace' : '#v2-tab-' + state.auxiliaryPage)?.focus())
  }
  function tabKey(event, page) {
    const index = workspacePages.indexOf(page)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2
      : event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : null
    if (next === null) return
    event.preventDefault()
    dispatch({ type: 'auxiliary', page: workspacePages[next] })
    root.current.querySelector('#v2-tab-' + workspacePages[next])?.focus()
  }
  function resizeKey(event) {
    const next = event.key === 'ArrowLeft' ? ratio - 0.02 : event.key === 'ArrowRight' ? ratio + 0.02
      : event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : event.key === 'Enter' ? defaultSplitRatio : null
    if (next === null) return
    event.preventDefault()
    dispatch({ type: 'split', value: renderedSplitRatio(next, available) })
  }
  function pointerDown(event) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { id: event.pointerId, ratio: state.splitRatio }
  }
  function pointerMove(event) {
    if (!resizable || drag.current?.id !== event.pointerId) return
    const offset = event.clientX - grid.current.getBoundingClientRect().left - 60 - listWidth
    dispatch({ type: 'split', value: renderedSplitRatio(offset / available, available) })
  }
  function pointerEnd(event, cancel = false) {
    if (drag.current?.id !== event.pointerId) return
    if (cancel) dispatch({ type: 'split', value: drag.current.ratio })
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return <div ref={root} onFocusCapture={event => { lastFocus.current = event.target }} className="app-shell compact-shell v2-shell" data-navigation={state.navigation} data-panel={panel} data-conversations={visible.conversations ? 'open' : 'closed'} style={{ '--v2-list-width': `${listWidth}px`, '--v2-primary-fr': `${primaryWeight}fr`, '--v2-auxiliary-fr': `${auxiliaryWeight}fr` }}>
    <a className="v2-skip" href={home ? '#v2-chat' : '#v2-page-' + state.navigation} onClick={() => { dispatch({ type: 'mobile', value: 'primary' }); requestAnimationFrame(() => root.current?.querySelector(home ? '#v2-chat' : '#v2-page-' + state.navigation)?.focus()) }}>跳到主体内容</a>
    <div className="v2-mobile-switch" role="group" aria-label="手机工作台视图" hidden={!home} inert={!home}>
      {['conversations', 'primary', 'auxiliary'].map((surface, i) => <Button key={surface} type="button" data-mobile={surface} aria-pressed={state.mobile === surface} onClick={() => dispatch({ type: 'mobile', value: surface })}>{['会话', home ? '聊天' : labels[state.navigation], '辅助栏'][i]}</Button>)}
    </div>
    <div ref={grid} className="v2-grid">
    <header className="v2-topbar" role="banner" aria-label="工作台工具栏"><ClockBadge value={clock}/><div className="v2-sidebar-toggle" hidden={!home} inert={!home}>
      <TooltipProvider delayDuration={250}><Tooltip><TooltipTrigger asChild>
        <Button id="v2-toggle-workspace" className="size-9 min-h-9 rounded-lg bg-transparent p-0 hover:bg-transparent max-lg:size-11 max-lg:min-h-11 [&_svg]:size-5" size="icon" type="button" aria-label={visible.auxiliary?'收起右侧栏':'展开右侧栏'} aria-expanded={visible.auxiliary} aria-controls={controls} onClick={()=>changePanel(visible.auxiliary?'collapsed':'normal',false)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M15 5v14"/></svg>
        </Button>
      </TooltipTrigger><TooltipContent side="bottom" align="end">{visible.auxiliary?'收起右侧栏':'展开右侧栏'}</TooltipContent></Tooltip></TooltipProvider>
    </div></header>
      <TooltipProvider delayDuration={250}><nav className="v2-navigation" aria-label="主导航">
        <Tooltip><TooltipTrigger asChild><Button className="v2-brand-toggle v2-nav-icon size-10 min-h-10 max-lg:size-11 max-lg:min-h-11 rounded-lg p-0 [&_svg]:size-5" size="icon" type="button" aria-label={visible.conversations?'收起会话列表':'展开会话列表'} aria-expanded={visible.conversations} aria-controls="v2-conversations" onClick={()=>{
          if(!home)dispatch({type:'navigate',page:'home'})
          if(narrow)dispatch({type:'mobile',value:visible.conversations?'primary':'conversations'})
          else {
            if(panel==='expanded')dispatch({type:'panel',value:'normal'})
            if(visible.conversations||!state.conversations)dispatch({type:'conversations'})
          }
        }}><span className="v2-brand-symbol"><span className="v2-brand-label">生长</span><svg className="v2-brand-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M10 5v14"/></svg></span></Button></TooltipTrigger><TooltipContent side={narrow?'top':'right'}>{visible.conversations?'收起会话列表':'展开会话列表'}</TooltipContent></Tooltip>
        {['home', ...workspacePages].map(page => <Tooltip key={page}><TooltipTrigger asChild><Button className="v2-nav-icon size-10 min-h-10 max-lg:size-11 max-lg:min-h-11 rounded-lg p-0 [&_svg]:size-5" size="icon" type="button" aria-label={labels[page]} aria-current={state.navigation === page ? 'page' : undefined} onClick={() => navigate(page)}><svg viewBox="0 0 24 24" aria-hidden="true">{navigationIcons[page]}</svg></Button></TooltipTrigger><TooltipContent side={narrow?'top':'right'}>{labels[page]}</TooltipContent></Tooltip>)}
      </nav></TooltipProvider>
      <aside id="v2-conversations" className="v2-conversations" aria-label="会话区域" hidden={!visible.conversations} inert={!visible.conversations}>
        <div id="v2-conversation-content" hidden={!visible.conversations} inert={!visible.conversations}>
          {conversationContent}
        </div>
      </aside>
      <main id="v2-chat" className="v2-chat" tabIndex={-1} aria-label="主聊天" hidden={!home || !visible.primary} inert={!home || !visible.primary}>
        <header className="v2-chat-heading"><h1 className="sr-only">首页</h1></header>
        {chatNote && <p className="v2-chat-note">{chatNote}</p>}
        {chat}
        {draftPanel&&<div id="v2-draft-preview" tabIndex={-1}>{draftPanel}</div>}
      </main>
      <div className="v2-resizer" role="separator" tabIndex={0} hidden={!resizable} inert={!resizable} aria-label="调整主体与辅助栏宽度" aria-orientation="vertical" aria-valuemin={Math.round(bounds.min * 100)} aria-valuemax={Math.round(bounds.max * 100)} aria-valuenow={Math.round(ratio * 100)} aria-valuetext={`主体占 ${Math.round(ratio * 100)}%`} onKeyDown={resizeKey} onDoubleClick={() => dispatch({ type: 'split', value: defaultSplitRatio })} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={event => pointerEnd(event, true)} onLostPointerCapture={() => { drag.current = null }} />
      <aside id="v2-workspace" className="v2-workspace" aria-label="辅助栏控制" hidden={!visible.auxiliary} inert={!visible.auxiliary}>
        <header className="v2-workspace-heading" hidden={!visible.auxiliary} inert={!visible.auxiliary}>
          <div className="v2-workspace-tabs" role="tablist" aria-label="辅助栏页签">{workspacePages.map(page => <Button key={page} id={'v2-tab-' + page} type="button" role="tab" aria-selected={state.auxiliaryPage === page} aria-controls={controls} tabIndex={state.auxiliaryPage === page ? 0 : -1} onKeyDown={event => tabKey(event, page)} onClick={() => dispatch({ type: 'auxiliary', page })}>{labels[page]}</Button>)}</div>
        </header>
      </aside>
      {workspacePages.map(page => {
        const placement = toolPlacement(state, page)
        const shown = placement !== 'hidden' && visible[placement]
        const content = page === 'schedule' ? children : page === 'review' ? review : profile
        const target = page === state.auxiliaryPage ? auxiliaryTarget : null
        return <section key={page} id={'v2-page-' + page} className="v2-tool-page" data-placement={placement} role="main" tabIndex={-1} aria-labelledby={'v2-primary-' + page} hidden={!shown} inert={!shown}>
          <header className="v2-primary-page-heading"><h1 className="sr-only" id={'v2-primary-' + page}>{labels[page]}</h1></header>
          {page !== 'schedule' && isValidElement(content) ? <Suspense fallback={<p role="status">正在加载{labels[page]}…</p>}>{cloneElement(content, { auxiliaryTarget: target })}</Suspense> : content}
        </section>
      })}
      <div id="v2-auxiliary-shared" className="v2-tool-page" data-placement="auxiliary" role="tabpanel" aria-labelledby={'v2-tab-' + state.auxiliaryPage} hidden={!visible.auxiliary} inert={!visible.auxiliary}>
        <div hidden={state.auxiliaryPage !== 'schedule'} inert={state.auxiliaryPage !== 'schedule'}>{auxiliarySchedule}</div>
        <div ref={setAuxiliaryTarget} />
      </div>
    </div>
  </div>
}
