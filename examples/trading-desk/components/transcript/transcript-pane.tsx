/**
 * TranscriptPane — left pane placeholder.
 *
 * Phase 1 / Step 4 stub: renders an empty-state card. Step 7 wires the
 * real renderers (phase divider, tool rows, speak rows) reading from
 * `session.items`.
 */
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

export function TranscriptPane(): ReactElement {
  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden",
        "border-r border-[color:var(--c-border)] bg-[color:var(--c-bg)]",
      )}
      aria-label="Transcript"
    >
      <div className="border-b border-[color:var(--c-border)] px-4 py-2.5">
        <h2 className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
          transcript
        </h2>
      </div>
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <p className="max-w-xs text-[12px] leading-relaxed text-[color:var(--c-fg-faint)]">
          The transcript will stream here once the analyst fan-out lands in
          Step 7. Until then this pane is intentionally empty.
        </p>
      </div>
    </section>
  );
}
