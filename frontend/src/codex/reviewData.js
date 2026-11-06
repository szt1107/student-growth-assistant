// Calendar strings are already grouped by the API in Asia/Shanghai.
export function dailyEffort(facts) {
  const rows = new Map(facts.by_day.map(row => [row.date, row]))
  const result = []
  for (let date = facts.start_date; date < facts.end_date_exclusive;) {
    const row = rows.get(date)
    result.push({ date, label: date.slice(5).replace('-', '/'),
      minutes: row?.feedback_ids.length && !(row.unknown_count && !row.known_minutes) ? row.known_minutes : null,
      unknown: row?.unknown_count || 0, task_ids: row?.task_ids || [],
      feedbackCount: row?.feedback_ids.length || 0 })
    const next = new Date(date + 'T12:00:00Z')
    next.setUTCDate(next.getUTCDate() + 1)
    date = next.toISOString().slice(0, 10)
  }
  return result
}

export function categoryEffort(facts) {
  return facts.by_category.map(row => ({ ...row,
    share: facts.known_minutes > 0 ? row.known_minutes / facts.known_minutes : null,
  })).sort((a, b) => b.known_minutes - a.known_minutes || a.name.localeCompare(b.name, 'zh-CN'))
}

export function reviewSources(sources, { status = 'all', query = '', taskIds = null, sort = 'time' } = {}) {
  const text = query.trim().toLocaleLowerCase()
  return sources.filter(row => (status === 'all' || row.states.includes(status)) &&
    (!text || row.title.toLocaleLowerCase().includes(text)) &&
    (taskIds === null || taskIds.includes(row.task_id))).slice().sort((a, b) =>
      sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') :
      sort === 'feedback' ? b.feedback_ids.length - a.feedback_ids.length || a.task_id - b.task_id :
      b.known_minutes - a.known_minutes || a.task_id - b.task_id)
}

export function effortLabel(row) {
  if (!row.feedback_ids.length) return '暂无投入记录'
  if (row.unknown_count && !row.known_minutes) return '耗时未知'
  return `${row.known_minutes} 分钟${row.unknown_count ? ' + 未知' : ''}`
}
