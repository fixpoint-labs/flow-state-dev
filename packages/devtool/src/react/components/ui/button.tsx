import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "../../lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-none font-fs-mono text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-fs-blue/40 focus-visible:border-fs-blue disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-fs-red [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-fs-ink text-fs-paper hover:bg-fs-blue",
        destructive: "border border-fs-red text-fs-red hover:bg-fs-red hover:text-fs-paper",
        outline: "border border-fs-ink/35 bg-transparent text-fs-ink hover:border-fs-ink",
        secondary: "border border-fs-ink/20 bg-fs-card text-fs-ink hover:border-fs-ink",
        ghost: "text-fs-ink2 hover:bg-fs-ink/5 hover:text-fs-ink",
        link: "text-fs-blue underline-offset-4 hover:text-fs-ink hover:underline",
      },
      size: {
        default: "h-8 px-3.5 has-[>svg]:px-3",
        xs: "h-6 gap-1 px-2 text-[11px] has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 px-2.5 has-[>svg]:px-2",
        lg: "h-9 px-5 has-[>svg]:px-4",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
