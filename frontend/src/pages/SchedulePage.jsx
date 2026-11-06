import { lazy, Suspense, useEffect, useState } from 'react'

const CalendarWorkspace = lazy(() => import('../components/CalendarWorkspace.jsx'))

// Calendar is a formal view. Business operations live in the main conversation.
export default function SchedulePage({ settings, active, auxiliaryActive, refreshVersion,
  onDataChanged, onOpenTask, onDiscussRules, renderWorkbench }) {
  const today = settings.now.slice(0, 10)
  const [visited, setVisited] = useState(active)
  const [auxiliaryVisited, setAuxiliaryVisited] = useState(auxiliaryActive)
  useEffect(() => { if (active) setVisited(true) }, [active])
  useEffect(() => { if (auxiliaryActive) setAuxiliaryVisited(true) }, [auxiliaryActive])
  const props = { workspace: settings.workspace_id, today, refreshVersion, onOpenTask,
    onDataChanged, onManageRules: onDiscussRules }
  const auxiliarySchedule = auxiliaryVisited && <Suspense fallback={<p role="status">正在加载日历…</p>}>
    <CalendarWorkspace {...props} compact active={auxiliaryActive} />
  </Suspense>
  return renderWorkbench({ auxiliarySchedule, children:
    <div className="assistant-workspace v2-planning-content">
      {visited && <Suspense fallback={<p role="status">正在加载完整日历…</p>}>
        <CalendarWorkspace {...props} active={active} />
      </Suspense>}
    </div>,
  })
}
