import test from 'node:test'
import assert from 'node:assert/strict'
import { dailyEffort, categoryEffort, reviewSources, effortLabel } from '../../src/codex/reviewData.js'

const sources = [
  { task_id: 1, title: '编程实践', states: ['completed'], known_minutes: 30, unknown_count: 1, feedback_ids: [1, 2] },
  { task_id: 2, title: '论文阅读', states: ['pending'], known_minutes: 0, unknown_count: 0, feedback_ids: [] },
  { task_id: 3, title: '练习', states: ['partial'], known_minutes: 0, unknown_count: 0, feedback_ids: [3] },
]
test('daily series preserves gaps, unknown time and explicit zero across month boundary', () => {
  const facts = { start_date: '2026-10-30', end_date_exclusive: '2026-11-03', by_day: [
    { date: '2026-10-30', known_minutes: 0, unknown_count: 1, feedback_ids: [1], task_ids: [1] },
    { date: '2026-11-01', known_minutes: 0, unknown_count: 0, feedback_ids: [2], task_ids: [3] },
  ] }
  const rows = dailyEffort(facts)
  assert.deepEqual(rows.map(row => row.date), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  assert.deepEqual(rows.map(row => row.minutes), [null, null, 0, null])
  assert.equal(rows[0].unknown, 1)
  assert.equal(rows[2].unknown, 0)
})
test('category rank uses known time only and never mutates API data', () => {
  const rows = [{ name: '阅读', known_minutes: 10 }, { name: '编程', known_minutes: 30 }]
  assert.deepEqual(categoryEffort({ by_category: rows, known_minutes: 40 }).map(row => row.share), [.75, .25])
  assert.equal(rows[0].name, '阅读')
  assert.equal(categoryEffort({ by_category: rows, known_minutes: 0 })[0].share, null)
})
test('status, keyword and selected chart intersection filter the same source rows', () => {
  assert.deepEqual(reviewSources(sources, { status: 'completed', query: '编程', taskIds: [1, 2] }).map(row => row.task_id), [1])
  assert.deepEqual(reviewSources(sources, { taskIds: [] }), [])
  assert.deepEqual(reviewSources(sources, { status: 'partial', taskIds: [1, 2] }), [])
  assert.equal(reviewSources(sources, { sort: 'feedback' })[0].task_id, 1)
  assert.equal(sources[0].task_id, 1)
})
test('pending, unknown and confirmed zero have different time labels', () => {
  assert.equal(effortLabel(sources[1]), '暂无投入记录')
  assert.equal(effortLabel(sources[2]), '0 分钟')
  assert.equal(effortLabel({ ...sources[0], known_minutes: 0 }), '耗时未知')
  assert.equal(effortLabel(sources[0]), '30 分钟 + 未知')
})
