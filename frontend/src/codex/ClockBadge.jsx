import { Clock3 } from 'lucide-react'

export default function ClockBadge({ value = '' }) {
  const match = /^(演示 · )?(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(value)
  if (!match) return null
  const [, , date, time] = match
  return <span className="workspace-clock"><time dateTime={`${date}T${time}:00+08:00`}><Clock3 size={14} aria-hidden="true"/><span>{date}</span><span>{time}</span></time></span>
}
