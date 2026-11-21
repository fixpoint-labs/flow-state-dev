import type { ReactNode } from "react";
import type { Look } from "../lib/looks";
import { cn } from "../lib/utils";

/** Stroke icons for the glyphs the shipped worker files set; any other glyph is drawn as text. */
const STROKE_ICONS: Record<string, ReactNode> = {
  "★": <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z" />,
  "🔎": (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.35-4.35" />
    </>
  ),
  "✎": <path d="M15.5 4.5l4 4L8 20H4v-4zM13.5 6.5l4 4" />,
};

const SIZES = {
  sm: { box: "size-5 rounded-[6px] text-xs", icon: 12, dot: "size-2" },
  md: { box: "size-[34px] rounded-[10px] text-sm", icon: 18, dot: "size-2.5" },
  lg: { box: "size-[38px] rounded-[10px] text-base", icon: 20, dot: "size-2.5" },
} as const;

/**
 * A teammate's icon on its color, the same wherever the teammate shows: a
 * rounded square tinted with the teammate's color, its icon stroked in that
 * color. With `presence`, a dot at the bottom right says whether it is
 * working (green) or idle, ringed in the background it sits on.
 */
export function Avatar({ look, size = "md", presence }: { look: Look; size?: keyof typeof SIZES; presence?: "working" | "idle" }) {
  const color = `var(--teammate-${look.color})`;
  const s = SIZES[size];
  const stroke = STROKE_ICONS[look.icon];
  return (
    <span aria-hidden data-avatar={look.color} data-icon={look.icon} className="relative inline-flex shrink-0">
      <span
        style={{ color, background: `var(--teammate-${look.color}-soft)` }}
        className={cn("flex items-center justify-center font-bold", s.box)}
      >
        {stroke ? (
          <svg width={s.icon} height={s.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {stroke}
          </svg>
        ) : (
          look.icon
        )}
      </span>
      {presence === undefined ? null : (
        <span
          data-presence={presence}
          className={cn("absolute -right-0.5 -bottom-0.5 rounded-full ring-2 ring-sidebar", s.dot, presence === "working" ? "bg-success" : "bg-presence-idle")}
        />
      )}
    </span>
  );
}
