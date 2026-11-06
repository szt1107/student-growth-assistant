import { cn } from '../lib/utils.js'
export function Badge({ className, variant = 'secondary', ...props }) { return <span data-slot="badge" data-variant={variant} className={cn('sga-badge inline-flex items-center rounded-md px-2 py-1 text-xs font-medium', variant === 'destructive' ? 'bg-destructive/10 text-destructive' : 'bg-secondary text-secondary-foreground', className)} {...props} /> }
