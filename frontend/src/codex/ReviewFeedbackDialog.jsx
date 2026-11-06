import { useEffect, useState } from 'react'
import { getTaskFeedback } from '../api.js'
import { shanghaiTime } from '../assistant.js'
import { Button, Alert } from './ui/controls.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog.jsx'

export default function ReviewFeedbackDialog({ source, onClose, onOpenTask }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const ids = [...new Set([...source.feedback_ids, ...source.completion_feedback_ids])]
  useEffect(() => {
    if (!ids.length) { setData([]); return }
    let valid = true
    setData(null); setError('')
    getTaskFeedback(source.task_id).then(result => { if (valid) setData(result.entries.filter(row => ids.includes(row.id))) })
      .catch(cause => { if (valid) setError(cause.message) })
    return () => { valid = false }
  }, [source, retry])
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent className="review-feedback-dialog">
    <DialogHeader><DialogTitle>{source.title}</DialogTitle><DialogDescription>所选回顾范围关联的执行反馈 · 只读查看</DialogDescription></DialogHeader>
    {error ? <Alert variant="destructive" role="alert">{error}<Button type="button" variant="ghost" onClick={() => setRetry(v => v + 1)}>重试读取反馈</Button></Alert> : data === null ? <p role="status">正在读取反馈…</p> :
      !data.length ? <p className="review-footnote">{ids.length ? '关联反馈可能已发生变化，请关闭并刷新回顾数据。' : '该安排尚无关联执行反馈，不能据此判断任务是否完成。'}</p> :
        <div className="review-feedback-list">{data.map(row => <article key={row.id}>
          <div><strong>{({ completed: '已完成', partial: '部分完成', postponed: '暂缓' })[row.outcome] || '已记录'}</strong><span>{Number.isFinite(row.actual_minutes) ? `${row.actual_minutes} 分钟` : '耗时未知'}</span></div>
          {row.reason && <p>{row.reason}</p>}
          <small>反馈 #{row.id}{row.created_at ? ` · 创建于 ${shanghaiTime(row.created_at).replace('T', ' ')}（北京时间）` : ''}{row.superseded ? ' · 已更正，请刷新回顾数据' : ''}</small>
        </article>)}</div>}
    <DialogFooter><Button type="button" variant="outline" onClick={onClose}>返回回顾</Button>{onOpenTask && <Button type="button" onClick={() => { onClose(); onOpenTask(source.task_id) }}>在日程中查看任务</Button>}</DialogFooter>
  </DialogContent></Dialog>
}
