import { cn } from '../lib/utils.js'
export function NativeSelect({ className, ...props }) {
  return <select data-slot="native-select" className={cn('sga-select h-10 min-w-0 rounded-2xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus-visible:outline-none disabled:opacity-50', className)} {...props} />
}
export const NativeSelectOption = props => <option {...props} />
