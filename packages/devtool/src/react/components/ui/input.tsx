import * as React from "react"

import { cn } from "../../lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-none border border-fs-ink/35 bg-fs-card px-2.5 py-1 font-fs-mono text-xs text-fs-ink transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-fs-ink placeholder:text-fs-ink4 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-fs-blue focus-visible:ring-2 focus-visible:ring-fs-blue/20",
        "aria-invalid:border-fs-red",
        className
      )}
      {...props}
    />
  )
}

export { Input }
