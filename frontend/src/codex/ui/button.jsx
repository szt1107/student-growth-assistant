// Adapted from shadcn/ui new-york-v4 (MIT); see LICENSE.shadcn-ui.txt.
import { cva } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { cn } from '../lib/utils.js'

const buttonVariants = cva('sga-button inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground hover:bg-primary/90',
      destructive: 'bg-destructive text-white hover:bg-destructive/90',
      outline: 'border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
      secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
      ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
      link: 'text-primary underline-offset-4 hover:underline'
    },
    size: { default: 'min-h-9 px-4 py-2', sm: 'min-h-8 px-3 py-1.5', lg: 'min-h-10 px-6 py-2', icon: 'size-9 p-0' }
  }, defaultVariants: { variant: 'default', size: 'default' }
})

function Button({ className = '', variant, size = 'default', asChild = false, ...props }) {
  // Preserve existing form semantics; new non-submit actions specify type="button".
  const legacy = className.split(/\s+/)
  const style = variant ?? (legacy.includes('danger') ? 'destructive' : legacy.includes('primary') || legacy.includes('aui-send') ? 'default' : legacy.includes('secondary') ? 'outline' : 'ghost')
  const retained = legacy.filter(name => !['button','primary','secondary','subtle','danger'].includes(name)).join(' ')
  const Comp = asChild ? Slot.Root : 'button'
  return <Comp data-slot="button" data-variant={style} data-size={size} className={cn(buttonVariants({ variant: style, size }), retained)} {...props} />
}
export { Button, buttonVariants }
