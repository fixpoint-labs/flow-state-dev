/**
 * tx-struct — collapsible card for a structured `block_output` (the
 * Phase 2+ research / trade / risk / PM agents emit one per turn).
 *
 * Phase 1 analyst structured outputs are suppressed from the transcript
 * (they surface only in the right pane), so this component ships in the
 * same PR as Phase 1 but is exercised first by Phase 2's
 * `InvestmentThesis` and beyond.
 */
"use client";

import { useState, type ReactElement } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type TxStructProps = {
  label: string;
  data: unknown;
};

export function TxStruct({ label, data }: TxStructProps): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-4 py-1">
      <div
        className={cn(
          "rounded-md border bg-[color:var(--c-surface)]",
          "border-[color:var(--c-border)]",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex w-full items-center gap-1.5 border-b border-dashed",
            "border-[color:var(--c-border)] px-3 py-1.5 text-left",
            "font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-accent-2)]",
          )}
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-3 w-3" aria-hidden />
          ) : (
            <ChevronRight className="h-3 w-3" aria-hidden />
          )}
          <span>⤓ {label}</span>
        </button>
        {open && (
          <pre
            className={cn(
              "max-h-[200px] overflow-auto px-3 py-2",
              "font-mono text-[11px] text-[color:var(--c-fg-muted)]",
            )}
          >
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
