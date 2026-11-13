import { Tabs as Primitive } from 'radix-ui'
import { cn } from '../lib/utils.js'
export const Tabs = Primitive.Root
export const TabsList = ({ className, ...props }) => <Primitive.List data-slot="tabs-list" className={cn('flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1', className)} {...props} />
export const TabsTrigger = ({ className, ...props }) => <Primitive.Trigger data-slot="tabs-trigger" className={cn('sga-button rounded-md border-0 bg-transparent px-3 py-2 text-sm text-muted-foreground data-[state=active]:bg-secondary data-[state=active]:text-secondary-foreground', className)} {...props} />
export const TabsContent = ({ className, ...props }) => <Primitive.Content data-slot="tabs-content" className={cn('min-w-0 outline-none', className)} {...props} />
