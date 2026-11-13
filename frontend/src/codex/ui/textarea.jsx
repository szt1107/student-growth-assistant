import { cn } from '../lib/utils.js'
export function Textarea({ className, ...props }) {
  return <textarea data-slot="textarea" className={cn('sga-textarea w-full min-w-0 rounded-2xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:outline-none disabled:opacity-50 aria-invalid:border-destructive', className)} {...props} />
}
