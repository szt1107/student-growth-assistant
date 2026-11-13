import { Button, Input, NativeSelect, Label } from '../codex/ui/controls.js'
import { useEffect, useState } from 'react'
import { getGrowthStatistics } from '../api.js'
import { minutesText, percentText, signedText } from '../analytics.js'
import { progressPercent } from '../workbench.js'
import ReviewWeeklyChart from '../codex/ReviewWeeklyChart.jsx'
import { reviewRange, shiftDate } from '../calendar.js'

export function WeeklyChart(props) {
  return <ReviewWeeklyChart {...props} />
}

export function AnalyticsContent({ data, parentTasks = [], active = true }) {
  const week = data.overview, estimate = data.estimation
  const cards = [
    ['计划任务', `${week.planned_task_count} 项`], ['确认完成', `${week.completed_count} 项`],
    ['计划时间', `${week.planned_minutes} 分钟`],
    ['反馈实际投入', minutesText(week.actual_minutes, week.known_actual_minutes, week.unknown_actual_count)],
  ]
  return <>
    <section className="growth-section" aria-label="成长统计概览">
      <h3>{week.start_date} 周概览</h3><div className="analytics-metrics">{cards.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    </section>
    <section className="growth-section" aria-label="跨周成长趋势">
      <h3>最近 {data.weeks} 周趋势</h3><p className="analytics-range">{data.start_date} 至 {shiftDate(data.end_date_exclusive, -1)}</p>
      {data.totals.data_state === 'no_records' && <p className="growth-empty">此范围没有可统计的安排或执行反馈。添加任务不会自动产生执行数据。</p>}
      <div className="analytics-charts"><WeeklyChart weekly={data.weekly} metric="completed_count" title="每周确认完成" unit="项" active={active} /><WeeklyChart weekly={data.weekly} metric="actual_minutes" title="每周反馈投入" unit="分钟" active={active} /></div>
      <details><summary>查看每周数据与缺失情况</summary><div className="analytics-table-wrap"><table><caption>每周真实记录（时间先后顺序）</caption><thead><tr><th>周一</th><th>计划任务</th><th>完成</th><th>计划分钟</th><th>实际投入</th><th>记录情况</th></tr></thead><tbody>{data.weekly.map(row => <tr key={row.start_date}><th scope="row">{row.start_date}</th><td>{row.planned_task_count}</td><td>{row.completed_count}</td><td>{row.planned_minutes}</td><td>{minutesText(row.actual_minutes, row.known_actual_minutes, row.unknown_actual_count)}</td><td>{row.data_state === 'no_records' ? '无安排/反馈记录' : `${row.feedback_count}条反馈，${row.unknown_actual_count}条缺耗时`}</td></tr>)}</tbody></table></div></details>
    </section>
    <section className="growth-section" aria-label="任务类别分布">
      <h3>类别投入 · 所选 {data.weeks} 周</h3>
      {!data.categories.length ? <p className="growth-empty">暂无类别执行记录。</p> : <div className="analytics-table-wrap"><table><caption>类别投入与确认完成</caption><thead><tr><th>类别</th><th>实际投入</th><th>确认完成</th><th>占已知分钟</th></tr></thead><tbody>{data.categories.map(category => <tr key={category.key}><th scope="row">{category.name}</th><td>{minutesText(category.actual_minutes, category.known_actual_minutes, category.unknown_actual_count)}{category.unknown_actual_count > 0 && <small> · {category.unknown_actual_count}条缺耗时</small>}</td><td>{category.completed_count} 项</td><td>{percentText(category.known_time_share)}{category.known_time_share !== null && <progress max="100" value={category.known_time_share * 100} aria-label={`${category.name}占已知投入比例`} />}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="growth-section" aria-label="估时偏差">
      <h3>原始估时与实际耗时</h3><p>有效配对 {estimate.sample_count} 项 · 原始预计 {estimate.estimated_minutes ?? '—'} 分钟 · 实际 {estimate.actual_minutes ?? '—'} 分钟 · 偏差 {signedText(estimate.difference_minutes)} 分钟（{percentText(estimate.deviation_ratio)}）</p>
      {estimate.status === 'insufficient_data' && <p className="analytics-meta">样本不足（{estimate.sample_count} / {estimate.minimum_samples} 项）</p>}
      {estimate.categories.length > 0 && <div className="analytics-table-wrap"><table><caption>各类别的可比较样本</caption><thead><tr><th>类别</th><th>有效样本</th><th>偏差分钟</th><th>偏差比例</th></tr></thead><tbody>{estimate.categories.map(category => <tr key={category.key}><th scope="row">{category.name}</th><td>{category.sample_count} 项{category.status === 'insufficient_data' ? '（样本不足）' : ''}</td><td>{signedText(category.difference_minutes)}</td><td>{percentText(category.deviation_ratio)}</td></tr>)}</tbody></table></div>}
      {estimate.categories.filter(category => category.observation).map(category => <p key={category.key} className="analytics-note">{category.name}：{category.observation}</p>)}
      {estimate.tasks.length > 0 && <details><summary>查看配对任务（最多 {estimate.task_detail_limit} 项，按超时分钟排序）</summary><div className="analytics-table-wrap"><table><caption>实际与原始估时对比</caption><thead><tr><th>任务</th><th>类别</th><th>原始分钟</th><th>实际分钟</th><th>差异分钟</th></tr></thead><tbody>{estimate.tasks.map(task => <tr key={task.task_id}><th scope="row">{task.title}</th><td>{task.category_name}</td><td>{task.estimated_minutes}</td><td>{task.actual_minutes}</td><td>{signedText(task.difference_minutes)}</td></tr>)}</tbody></table></div></details>}
    </section>
    <section className="growth-section" aria-label="长期目标实时进展">
      <h3>目标进展 · {week.start_date} 周</h3>
      {!data.goals.length ? <p className="growth-empty">暂无目标。</p> : <div className="goal-list">{data.goals.map(goal => {
        const percent = progressPercent(goal.actual, goal.target)
        return <article className="goal-card" key={goal.goal_id}><div className="goal-card-top"><h4>{goal.goal_title}</h4><span className="badge">{goal.status === 'active' ? '进行中' : goal.status === 'paused' ? '已暂停' : goal.status === 'completed' ? '已完成' : '已归档'}</span></div>
          <p>本周确认进展：{goal.actual ?? '未知'} / {goal.target} {goal.unit_label}</p>
          {goal.actual === null && <p className="analytics-meta">已知小计 {goal.known_actual} 分钟，{goal.unknown_actual_count} 条缺耗时或尚无反馈</p>}
          {percent !== null && <progress max="100" value={percent} aria-label={`${goal.goal_title}本周进展`} />}
          <p className="analytics-meta">当前关联 {goal.linked_task_count} 项可执行任务，其中已完成 {goal.linked_done_count} 项、已取消 {goal.linked_cancelled_count} 项</p>
        </article>
      })}</div>}
      {parentTasks.length > 0 && <details><summary>项目父容器当前进度</summary>{parentTasks.map(parent => <p key={parent.id}>{parent.title}：{parent.progress?.completed_children ?? 0} / {parent.progress?.total_children ?? 0} 项完成，{parent.progress?.cancelled_children ?? 0} 项取消</p>)}</details>}
    </section>
  </>
}

export function AnalyticsState({ loading, error, onRetry }) {
  if (loading) return <p role="status" className="state-box">正在汇总成长记录…</p>
  if (error) return <div role="alert" className="error-box">统计暂时无法加载：{error} <Button type="button" className="button subtle" onClick={onRetry}>重试统计</Button></div>
  return null
}

export default function GrowthAnalytics({ refreshVersion = 0, parentTasks = [], onRefresh, onOverview, onOverviewError, active = true }) {
  const [weeks, setWeeks] = useState(4), [data, setData] = useState(null), [loading, setLoading] = useState(true)
  const [error, setError] = useState(''), [retry, setRetry] = useState(0), [endWeek, setEndWeek] = useState('')
  useEffect(() => {
    if (!active) return
    let valid = true
    setLoading(true); setError(''); setData(null)
    getGrowthStatistics(weeks,endWeek||undefined).then(result => {
      if (valid) { setData(result); onOverview?.(result.overview); onOverviewError?.('') }
    }).catch(cause => {
      if (valid) { setError(cause.message); onOverviewError?.(cause.message) }
    }).finally(() => { if (valid) setLoading(false) })
    return () => { valid = false }
  }, [active, weeks, endWeek, refreshVersion, retry, onOverview, onOverviewError])
  return <section className="growth-analytics" aria-labelledby="analytics-heading" aria-busy={loading}>
    <div className="growth-section-heading"><h3 id="analytics-heading">成长统计</h3><div className="analytics-controls"><Label>截至周（周一）<Input type="date" min="2000-01-01" max="2100-12-31" value={endWeek||data?.overview.start_date||''} onChange={event=>setEndWeek(event.target.value?reviewRange(event.target.value,'week')[0]:'')}/></Label><Label>统计范围<NativeSelect value={weeks} onChange={event => setWeeks(Number(event.target.value))}>{[4, 8, 12].map(value => <option key={value} value={value}>最近 {value} 周</option>)}</NativeSelect></Label><Button type="button" className="button subtle" disabled={loading} onClick={() => {setRetry(value => value + 1);onRefresh?.()}}>刷新统计</Button></div></div>
    <AnalyticsState loading={loading || Boolean(data && data.weeks !== weeks)} error={error} onRetry={() => setRetry(value => value + 1)} />
    {data?.weeks === weeks && <AnalyticsContent data={data} parentTasks={parentTasks} active={active} />}
  </section>
}
