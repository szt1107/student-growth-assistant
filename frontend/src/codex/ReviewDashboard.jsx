import { useMemo, useState } from 'react'
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { CheckCheck, Clock3, MessageSquareText, CircleHelp, Search, X, ArrowUpRight, ChartNoAxesColumnIncreasing } from 'lucide-react'
import { Button, Input, NativeSelect, Label } from './ui/controls.js'
import { dailyEffort, categoryEffort, reviewSources, effortLabel } from './reviewData.js'
import { recordedTime } from '../workbench.js'
import ReviewFeedbackDialog from './ReviewFeedbackDialog.jsx'
import './review-dashboard.css'

const stateNames = { completed: '已完成', partial: '部分完成', pending: '待反馈', recorded: '已记录' }
function EffortTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return <div className="review-chart-tooltip"><strong>{row.date}</strong><span>{row.unknown && !row.minutes ? '耗时未知' : `${row.minutes} 分钟${row.unknown ? ' + 未知' : ''}`}</span><small>{row.feedbackCount} 条有效反馈</small></div>
}

export default function ReviewDashboard({ facts, onOpenTask, active = true }) {
  const [status, setStatus] = useState('all'), [query, setQuery] = useState(''), [sort, setSort] = useState('time')
  const [selection, setSelection] = useState(null)
  const [openedSource, setOpenedSource] = useState(null)
  const daily = useMemo(() => dailyEffort(facts), [facts])
  const categories = useMemo(() => categoryEffort(facts), [facts])
  const rows = reviewSources(facts.sources, { status, query, sort, taskIds: selection?.taskIds ?? null })
  const select = (key, label, taskIds) => setSelection(current => current?.key === key ? null : { key, label, taskIds })
  const selectMetric = (key) => {
    setQuery(''); setSelection(null)
    setStatus(key === 'completed' || key === 'pending' ? key : 'all')
    if (key === 'effort') setSelection({ key: 'effort', label: '有投入反馈的任务', taskIds: facts.task_ids })
  }
  const metrics = [
    { key: 'completed', title: '已确认完成', value: facts.completed_count, unit: '项', note: '以有效完成记录为准', Icon: CheckCheck },
    { key: 'effort', title: '已记录投入', value: !facts.feedback_ids.length ? '—' : facts.unknown_count && !facts.known_minutes ? '未知' : facts.known_minutes, unit: facts.feedback_ids.length && !(facts.unknown_count && !facts.known_minutes) ? '分钟' : '', note: facts.unknown_count ? `另有 ${facts.unknown_count} 条反馈耗时未知` : facts.feedback_ids.length ? '仅汇总已知实际耗时' : '当前范围暂无投入反馈', Icon: Clock3 },
    { key: 'pending', title: '待反馈安排', value: facts.pending_count, unit: '项', note: '已结束安排，等待补充反馈', Icon: CircleHelp },
    { key: 'feedback', title: '有效反馈', value: facts.feedback_ids.length, unit: '条', note: '点击查看全部回顾事项', Icon: MessageSquareText },
  ]
  return <div className="review-dashboard">
    <div className="review-metrics" aria-label="回顾概览">{metrics.map(({ key, title, value, unit, note, Icon }) =>
      <Button className="metric-card review-kpi" key={key} aria-pressed={key === 'completed' || key === 'pending' ? status === key : key === 'effort' ? selection?.key === key : status === 'all' && !selection} onClick={() => selectMetric(key)}>
        <span className="review-kpi-label"><span>{title}</span><Icon size={17} aria-hidden="true" /></span>
        <strong>{value}<small>{unit}</small></strong><span className="review-kpi-note">{note}</span>
      </Button>)}</div>

    <div className="review-viz-grid">
      <section className="review-data-card review-daily" aria-labelledby="review-effort-title">
        <div className="review-card-heading"><div><h3 id="review-effort-title">投入趋势</h3><p>每日已知投入 · 分钟</p></div><span className="review-card-icon"><ChartNoAxesColumnIncreasing size={18} aria-hidden="true" /></span></div>
        {facts.feedback_ids.length ? <>
          <div className="review-chart" role="img" aria-label="每日已知投入柱状图，详细数值与筛选按钮在下方">
            {active && <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={daily} margin={{ top: 14, right: 8, bottom: 0, left: -22 }} accessibilityLayer>
                <CartesianGrid vertical={false} stroke="var(--sga-border)" strokeDasharray="3 4" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={20} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                <Tooltip content={<EffortTooltip />} cursor={{ fill: 'var(--sga-muted)' }} />
                <Bar dataKey="minutes" fill="var(--sga-primary)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}
                  onClick={row => select('day:' + row.date, row.date, row.task_ids)} style={{ cursor: 'pointer' }} />
              </BarChart>
            </ResponsiveContainer>}
          </div>
          <div className="review-day-strip" role="group" aria-label="按日期查看投入记录">{daily.map(row =>
            <Button className="button subtle review-day" key={row.date} aria-label={`${row.date}：${!row.feedbackCount ? '无投入记录' : row.unknown && !row.minutes ? '耗时未知' : `${row.minutes} 分钟${row.unknown ? '，另有未知耗时' : ''}`}，筛选明细`}
              aria-pressed={selection?.key === 'day:' + row.date} onClick={() => select('day:' + row.date, row.date, row.task_ids)}>
              <span>{row.label}</span><strong>{!row.feedbackCount || row.unknown && !row.minutes ? '—' : `${row.unknown ? '≥' : ''}${row.minutes}`}</strong>
            </Button>)}</div>
        </> : <div className="review-empty-chart"><Clock3 size={28} aria-hidden="true" /><strong>还没有投入记录</strong><p>补充任务的执行反馈后，就能看到时间分布。</p></div>}
        <p className="review-footnote">柱高仅表示已知分钟；“—”表示无记录或耗时未知，具体情况见日期提示。点击日期或柱形筛选明细。</p>
      </section>

      <section className="review-data-card review-categories" aria-labelledby="review-category-title">
        <div className="review-card-heading"><div><h3 id="review-category-title">时间花在哪里</h3><p>类别投入 · 占已知分钟的比例</p></div><span className="review-card-total">{facts.known_minutes} <small>分钟已知</small></span></div>
        {!categories.length ? <div className="review-empty-chart"><strong>暂无类别投入</strong><p>有执行反馈后，按任务类别汇总在这里。</p></div> :
          <div className="review-category-list">{categories.map(row => <Button className="review-category-row" key={row.key} aria-pressed={selection?.key === 'category:' + row.key}
            onClick={() => select('category:' + row.key, row.name, row.task_ids)}>
            <span className="review-category-info"><strong>{row.name}</strong><span>{effortLabel(row)}<small>{row.share === null ? '占比未知' : `${(row.share * 100).toFixed(1)}%`}</small></span></span>
            <span className="review-category-track" aria-hidden="true"><span style={{ width: `${(row.share || 0) * 100}%` }} /></span>
          </Button>)}</div>}
        {facts.unknown_count > 0 && <p className="review-footnote">另有 {facts.unknown_count} 条耗时未知的反馈，未纳入比例计算。</p>}
      </section>
    </div>

    <section className="review-data-card review-details" aria-labelledby="review-details-title">
      <div className="review-card-heading"><div><h3 id="review-details-title">执行明细 <span className="review-count">{rows.length}</span></h3><p>从趋势和类别中定位记录，也可以直接搜索。</p></div>
        <Label className="review-search"><Search size={16} aria-hidden="true" /><span className="visually-hidden">搜索回顾任务</span><Input type="search" placeholder="搜索任务…" value={query} onChange={e => setQuery(e.target.value)} /></Label>
      </div>
      <div className="review-filterbar"><div className="review-status-filter" role="group" aria-label="回顾事项筛选">{[['all', '全部'], ['completed', '已完成'], ['partial', '部分完成'], ['pending', '待反馈']].map(([key, label]) =>
        <Button className="button subtle" key={key} aria-pressed={status === key} onClick={() => setStatus(key)}>{label}</Button>)}</div>
        <Label className="review-sort"><span className="visually-hidden">明细排序</span><NativeSelect value={sort} onChange={e => setSort(e.target.value)}><option value="time">投入从多到少</option><option value="feedback">反馈从多到少</option><option value="title">按任务名称</option></NativeSelect></Label>
      </div>
      {selection && <div className="review-selection" role="status"><span>正在查看：{selection.label}</span><Button className="button subtle" onClick={() => setSelection(null)} aria-label="清除图表筛选"><X size={14} aria-hidden="true" />清除</Button></div>}
      <p className="visually-hidden" role="status">显示 {rows.length} 项回顾事项</p>
      {!rows.length ? <div className="review-empty-results"><p>{facts.sources.length ? '没有符合筛选条件的任务。' : '这个时段还没有可回顾的事项。'}</p>{(selection || query || status !== 'all') && <Button className="button secondary" onClick={() => { setSelection(null); setStatus('all'); setQuery('') }}>清除全部筛选</Button>}</div> :
        <div className="review-source-table"><table><caption className="visually-hidden">所选范围的任务执行记录</caption><thead><tr><th>任务</th><th>记录状态</th><th>实际投入</th><th>反馈</th><th><span className="visually-hidden">操作</span></th></tr></thead><tbody>{rows.map(row => <tr key={row.task_id}>
          <th scope="row"><span className="review-task-title">{row.title}</span></th>
          <td><div className="review-state-badges">{row.states.map(state => <span className="review-state" data-state={state} key={state}>{stateNames[state] || state}</span>)}</div></td>
          <td className="review-time-cell">{effortLabel(row)}</td><td><details><summary>{row.feedback_ids.length} 条</summary><p>{row.completion_feedback_ids.length} 条完成记录。待反馈不等于未完成。</p></details></td>
          <td><Button className="button subtle review-open-task" aria-label={`查看任务与反馈：${row.title}`} onClick={() => setOpenedSource(row)}>查看<ArrowUpRight size={14} aria-hidden="true" /></Button></td>
        </tr>)}</tbody></table></div>}
      <p className="review-footnote">待反馈表示已结束的安排尚未补充反馈，不代表任务未完成。状态可能同时包含完成与部分投入记录。</p>
    </section>

    {facts.goals.length > 0 && <section className="review-data-card" aria-labelledby="review-goals-title"><div className="review-card-heading"><div><h3 id="review-goals-title">目标投入与进展</h3><p>仅展示所选时段内有关联执行记录的目标。</p></div></div>
      <div className="review-goal-grid">{facts.goals.map(goal => <article className="review-goal" key={goal.id}><h4>{goal.title}</h4><strong>{goal.metric_kind === 'time' ? recordedTime(goal.value, goal.unknown_count) : `${goal.value} ${goal.unit}`}</strong><p>{goal.note}</p></article>)}</div>
    </section>}
    <details className="review-definitions"><summary>统计口径与记录完整性{facts.unknown_count ? ` · ${facts.unknown_count} 条耗时未知` : ''}</summary><p>{facts.note}</p><p>数据截至 {facts.as_of?.replace('T', ' ').slice(0, 16)}（北京时间）。完成、投入和待反馈采用不同口径，不能相加计算完成率。</p></details>
    {openedSource && active && <ReviewFeedbackDialog source={openedSource} onClose={() => setOpenedSource(null)} onOpenTask={onOpenTask} />}
  </div>
}
