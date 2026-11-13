import { DropdownMenu as Primitive } from 'radix-ui'
import { cn } from '../lib/utils.js'
export const DropdownMenu = Primitive.Root
export const DropdownMenuTrigger = Primitive.Trigger
export function DropdownMenuContent({ className, sideOffset = 6, ...props }) { return <Primitive.Portal><Primitive.Content data-slot="dropdown-menu-content" sideOffset={sideOffset} className={cn('z-50 grid max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-40 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-border bg-background p-1 text-foreground shadow-md', className)} {...props} /></Primitive.Portal> }
export const DropdownMenuItem = ({ className, ...props }) => <Primitive.Item data-slot="dropdown-menu-item" className={cn('relative flex cursor-default select-none items-center rounded-sm px-3 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50', className)} {...props} />
export const DropdownMenuSeparator = () => <Primitive.Separator className="my-1 h-px bg-border" />
