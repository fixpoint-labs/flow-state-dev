/**
 * tx-phase — phase-divider row in the transcript.
 *
 * Renders a horizontal rule + the container's `label` in mono / faint
 * tracking-wide. The transcript pane keys on `container.component ===
 * "analyst-phase"` (and any later `phase-*` component value) to render this.
 */
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

export function TxPhase({ label }: { label: string }): ReactElement {
  return (
    <div className="my-3 flex items-center gap-3 px-4">
      <div className="h-px flex-1 bg-[color:var(--c-border)]" />
      <span
        className={cn(
          "font-mono text-[10.5px] uppercase tracking-wider",
          "text-[color:var(--c-fg-faint)]",
        )}
      >
        {label}
      </span>
      <div className="h-px flex-1 bg-[color:var(--c-border)]" />
    </div>
  );
}
