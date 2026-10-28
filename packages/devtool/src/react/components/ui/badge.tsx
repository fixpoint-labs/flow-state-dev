import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "../../lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-none border px-1.5 py-px font-fs-mono text-[10.5px] font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-fs-blue/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-fs-ink bg-fs-ink text-fs-paper",
        secondary: "border-fs-ink/35 text-fs-ink3",
        destructive: "border-fs-red text-fs-red",
        outline: "border-fs-ink/45 text-fs-ink2 [a&]:hover:border-fs-ink",
        ghost: "border-transparent text-fs-ink3 [a&]:hover:bg-fs-ink/5",
        link: "border-transparent text-fs-blue underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
