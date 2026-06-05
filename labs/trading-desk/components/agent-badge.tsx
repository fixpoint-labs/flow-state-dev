/**
 * AgentBadge — 2-character glyph chip with per-agent accent hue.
 *
 * Three treatments:
 *   - subtle: faint surface, no border (used for inline references in copy)
 *   - medium: surfaced fill, mono glyph (used for transcript and memo headers)
 *   - loud:   accent-tinted fill (used for pending/awaiting placeholders)
 *
 * Per-agent color comes through the `--c` CSS custom property, which the
 * caller sets to `oklch(62% 0.12 <hue>)` from the AGENTS table.
 */
import type { CSSProperties, ReactElement } from "react";
import { AGENTS, type AgentName } from "@/src/flows/trading-desk/registry";
import { cn } from "@/lib/utils";

type AgentBadgeProps = {
  agent: AgentName;
  treatment?: "subtle" | "medium" | "loud";
  className?: string;
};

export function AgentBadge({
  agent,
  treatment = "medium",
  className,
}: AgentBadgeProps): ReactElement {
  const meta = AGENTS[agent];
  const style = {
    "--c": `oklch(62% 0.12 ${meta.hue})`,
  } as CSSProperties;

  return (
    <span
      role="img"
      aria-label={meta.role}
      title={meta.role}
      className={cn(
        "inline-flex items-center justify-center select-none",
        "h-6 min-w-6 px-1 rounded-md font-mono text-[10.5px] tracking-tight",
        treatment === "subtle" && "text-[color:var(--c-fg-muted)]",
        treatment === "medium" &&
          "bg-[color:var(--c-surface-2)] text-[color:var(--c)] border border-[color:var(--c-border)]",
        treatment === "loud" &&
          "text-white border border-[color:var(--c)] bg-[color:var(--c)]/85",
        className,
      )}
      style={style}
    >
      {meta.glyph}
    </span>
  );
}
