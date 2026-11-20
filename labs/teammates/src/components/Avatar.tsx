import type { Look } from "../lib/looks";
import { cn } from "../lib/utils";

/** A teammate's icon on its color, the same wherever the teammate shows. */
export function Avatar({ look, size = "md" }: { look: Look; size?: "sm" | "md" | "lg" }) {
  const color = `var(--teammate-${look.color})`;
  return (
    <span
      aria-hidden
      data-avatar={look.color}
      style={{ color, background: `color-mix(in srgb, ${color} 18%, transparent)` }}
      className={cn("flex shrink-0 items-center justify-center rounded-full font-bold", size === "lg" ? "size-[38px] text-base" : size === "md" ? "size-8 text-sm" : "size-5 text-xs")}
    >
      {look.icon}
    </span>
  );
}
