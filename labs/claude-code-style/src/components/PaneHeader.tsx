import type { ReactNode } from "react";
import { cn } from "../lib/utils";

/**
 * The one header every column draws: the sessions list, the main thread and
 * the right pane. They share a fixed height, so the rule under each sits on
 * the same line across the screen; a header that sized itself to its content
 * put three rules at three heights.
 */
export function PaneHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <header className={cn("flex h-14 shrink-0 items-center gap-3 border-b border-border px-4", className)}>{children}</header>;
}
