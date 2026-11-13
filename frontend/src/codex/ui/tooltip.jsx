import { Tooltip as Primitive } from 'radix-ui'
export const TooltipProvider = Primitive.Provider
export const Tooltip = Primitive.Root
export const TooltipTrigger = Primitive.Trigger
export const TooltipContent = props => <Primitive.Portal><Primitive.Content sideOffset={6} className="z-50 rounded-md border border-foreground bg-foreground px-3 py-2 text-xs text-background shadow-md" {...props} /></Primitive.Portal>
