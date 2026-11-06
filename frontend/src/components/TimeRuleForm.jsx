import { Button, Input, NativeSelect, Label } from '../codex/ui/controls.js'
import { useState } from 'react'
import { WEEKDAYS } from '../constants.js'
import { timeRuleFormPayload } from '../timeRules.js'

export default function TimeRuleForm({ kind, rule, pending, onSubmit, onCancel, submitLabel, cancelLabel = '取消' }) {
  const [title, setTitle] = useState(rule?.title ?? '')
  const [recurrence, setRecurrence] = useState(rule?.recurrence ?? 'weekly')
  const [weekday, setWeekday] = useState(rule?.weekday?.toString() ?? '')
  const [date, setDate] = useState(rule?.date ?? '')
  const [startTime, setStartTime] = useState(rule?.start_time?.slice(0, 5) ?? '')
  const [endTime, setEndTime] = useState(rule?.end_time?.slice(0, 5) ?? '')

  function changeRecurrence(value) {
    setRecurrence(value)
    setWeekday('')
    setDate('')
  }

  function submit(event) {
    event.preventDefault()
    if (pending) return
    onSubmit(timeRuleFormPayload({ kind, title, recurrence, weekday, date, startTime, endTime }, rule))
  }

  return (
    <form className="editor" onSubmit={submit}>
      <div className="form-grid">
        <Label className="span-two">标题
          <Input value={title} onChange={(event) => setTitle(event.target.value)} required disabled={pending} />
        </Label>
        {<Label>重复方式
          <NativeSelect value={recurrence} onChange={(event) => changeRecurrence(event.target.value)} disabled={pending}>
            <option value="weekly">每周</option>
            <option value="once">仅一次</option>
          </NativeSelect>
        </Label>}
        {recurrence === 'weekly' ? <Label>星期
          <NativeSelect value={weekday} onChange={(event) => setWeekday(event.target.value)} required disabled={pending}>
            <option value="">请选择星期</option>
            {WEEKDAYS.map((day, index) => <option value={index + 1} key={day}>{day}</option>)}
          </NativeSelect>
        </Label> : <Label>日期
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required disabled={pending} />
        </Label>}
        <Label>开始时间
          <Input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required disabled={pending} />
        </Label>
        <Label>结束时间
          <Input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required disabled={pending} />
        </Label>
      </div>
      <div className="button-row">
        <Button className="button primary" type="submit" disabled={pending}>{pending ? '正在保存…' : submitLabel || (rule ? '保存修改' : `添加${kind === 'course' ? '课程' : '保留时间'}`)}</Button>
        <Button className="button subtle" type="button" onClick={onCancel} disabled={pending}>{cancelLabel}</Button>
      </div>
    </form>
  )
}
