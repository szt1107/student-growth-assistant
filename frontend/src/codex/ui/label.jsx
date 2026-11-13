import { Label as Primitive } from 'radix-ui'
import { cn } from '../lib/utils.js'
export function Label({ className, ...props }) { return <Primitive.Root data-slot="label" className={cn('text-sm font-medium', className)} {...props} /> }
