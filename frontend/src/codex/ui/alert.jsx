import { cn } from '../lib/utils.js'
export function Alert({ className, variant = 'default', role = 'status', ...props }) { return <div role={role} data-slot="alert" data-variant={variant} className={cn('sga-alert rounded-lg border border-border bg-background p-4 text-sm', className)} {...props} /> }
export const AlertTitle = props => <h4 data-slot="alert-title" {...props} />
export const AlertDescription = props => <div data-slot="alert-description" {...props} />
