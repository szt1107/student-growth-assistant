import { useState } from 'react'
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Button } from './ui/controls.js'
import { weeklyValue } from '../analytics.js'

function WeeklyTooltip({ active, payload, unit }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return <div className="review-chart-tooltip"><strong>{row.start_date} 周</strong><span>{row.value === null ? '耗时未知或无反馈' : `${row.incomplete ? '已知至少 ' : ''}${row.value} ${unit}`}</span><small>{row.feedback_count} 条有效反馈 · {row.unknown_actual_count} 条缺耗时</small></div>
}

export default function ReviewWeeklyChart({ weekly, metric, title, unit, active = true }) {
  const [selected, setSelected] = useState(null)
  const data = weekly.map(row => ({ ...row, label: row.start_date.slice(5).replace('-', '/'),
    value: weeklyValue(row, metric), incomplete: metric === 'actual_minutes' && row.actual_minutes === null && row.unknown_actual_count > 0 }))
  const chosen = data.find(row => row.start_date === selected)
  return <figure className="review-weekly-chart">
    <figcaption>{title} <span>{unit}</span></figcaption>
    <div className="review-chart" role="img" aria-label={`${title}，按北京时间周一开始；详细数据见下方表格`}>
      {active && <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: -22 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--sga-border)" strokeDasharray="3 4" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={16} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
          <YAxis axisLine={false} tickLine={false} allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
          <Tooltip content={<WeeklyTooltip unit={unit} />} cursor={{ fill: 'var(--sga-muted)' }} />
          <Bar dataKey="value" fill={metric === 'completed_count' ? 'var(--sga-primary)' : '#759c8a'} maxBarSize={32} radius={[4, 4, 0, 0]} isAnimationActive={false}
            onClick={row => setSelected(current => current === row.start_date ? null : row.start_date)} style={{ cursor: 'pointer' }} />
        </BarChart>
      </ResponsiveContainer>}
    </div>
    <div className="review-day-strip" role="group" aria-label={`${title}按周查看`}>{data.map(row =>
      <Button className="button subtle review-day" key={row.start_date} aria-pressed={selected === row.start_date}
        aria-label={`${row.start_date}周：${row.value === null ? '耗时未知或无反馈' : `${row.incomplete ? '已知至少' : ''}${row.value}${unit}`}`}
        onClick={() => setSelected(current => current === row.start_date ? null : row.start_date)}>
        <span>{row.label}</span><strong>{row.value === null ? '—' : `${row.incomplete ? '≥' : ''}${row.value}`}</strong>
      </Button>)}</div>
    {chosen && <p className="review-week-selection" role="status">{chosen.start_date} 周 · {chosen.feedback_count} 条有效反馈，{chosen.unknown_actual_count} 条耗时缺失。{chosen.data_state === 'no_records' ? '无安排或反馈记录。' : ''}</p>}
  </figure>
}
