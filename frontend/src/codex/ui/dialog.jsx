// shadcn/ui Radix composition, adapted to JS and the existing green theme (MIT).
import { Dialog as Primitive } from 'radix-ui'
import { X } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { Button } from './button.jsx'
export const Dialog = Primitive.Root
export const DialogTrigger = Primitive.Trigger
export const DialogClose = Primitive.Close
export function DialogContent({ className, children, showCloseButton = true, ...props }) {
  return <Primitive.Portal><Primitive.Overlay data-slot="dialog-overlay" className="fixed inset-0 z-50 bg-black/40" /><Primitive.Content data-slot="dialog-content" className={cn('sga-dialog-body fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-background p-6 text-foreground shadow-lg', className)} {...props}>{children}{showCloseButton && <Primitive.Close asChild><Button type="button" variant="ghost" size="icon" className="sga-dialog-close"><X /><span className="sr-only">关闭弹窗</span></Button></Primitive.Close>}</Primitive.Content></Primitive.Portal>
}
export const DialogHeader = ({ className, ...props }) => <div className={cn('grid gap-2 pr-8', className)} {...props} />
export const DialogFooter = ({ className, ...props }) => <div className={cn('flex flex-wrap justify-end gap-2 pt-2', className)} {...props} />
export const DialogTitle = ({ className, ...props }) => <Primitive.Title data-slot="dialog-title" className={cn('m-0 text-lg font-semibold', className)} {...props} />
export const DialogDescription = ({ className, ...props }) => <Primitive.Description className={cn('m-0 text-sm text-muted-foreground', className)} {...props} />
