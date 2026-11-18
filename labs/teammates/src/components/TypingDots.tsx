/**
 * Three dots that bounce while someone is writing. Decorative: the words beside
 * them say what is happening. They hold still when `active` is off (a stale feed,
 * or a step that waits on you) and under `prefers-reduced-motion` (styles.css).
 */
import { cn } from "../lib/utils";

export function TypingDots({ active, className }: { active: boolean; className?: string }) {
  return (
    <span aria-hidden="true" data-typing-dots data-active={active} className={cn("inline-flex items-center gap-1", className)}>
      <span />
      <span />
      <span />
    </span>
  );
}
