import { AlertDialog as Primitive } from 'radix-ui'
import { cn } from '../lib/utils.js'
export const AlertDialog = Primitive.Root
export const AlertDialogTrigger = Primitive.Trigger
export const AlertDialogCancel = Primitive.Cancel
export const AlertDialogAction = Primitive.Action
export const AlertDialogTitle = props => <Primitive.Title className="m-0 text-lg font-semibold" {...props} />
export const AlertDialogDescription = props => <Primitive.Description className="m-0 text-sm leading-7 text-muted-foreground" {...props} />
export function AlertDialogContent({ className, ...props }) { return <Primitive.Portal><Primitive.Overlay className="fixed inset-0 z-50 bg-black/40" /><Primitive.Content data-slot="alert-dialog-content" className={cn('fixed left-1/2 top-1/2 z-50 grid max-h-[85dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border bg-background p-6 text-foreground shadow-lg', className)} {...props} /></Primitive.Portal> }
