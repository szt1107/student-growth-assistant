import { cn } from '../lib/utils.js'
export function Input({ className, type, ...props }) {
  const choice = type === 'checkbox' || type === 'radio'
  return <input data-slot="input" type={type} className={cn(choice ? 'sga-input size-4 shrink-0 accent-primary disabled:opacity-50' : 'sga-input h-10 w-full min-w-0 rounded-2xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:outline-none disabled:opacity-50 aria-invalid:border-destructive', className)} {...props} />
}
