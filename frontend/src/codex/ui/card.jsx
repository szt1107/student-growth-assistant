import { cn } from '../lib/utils.js'
export const Card = ({ className, ...props }) => <section data-slot="card" className={cn('rounded-xl border border-border bg-card text-card-foreground', className)} {...props} />
export const CardHeader = ({ className, ...props }) => <div data-slot="card-header" className={cn('p-5', className)} {...props} />
export const CardTitle = props => <h3 data-slot="card-title" {...props} />
export const CardDescription = props => <p data-slot="card-description" className="text-sm text-muted-foreground" {...props} />
export const CardContent = ({ className, ...props }) => <div data-slot="card-content" className={cn('p-5 pt-0', className)} {...props} />
export const CardFooter = ({ className, ...props }) => <div data-slot="card-footer" className={cn('flex flex-wrap gap-2 p-5 pt-0', className)} {...props} />
