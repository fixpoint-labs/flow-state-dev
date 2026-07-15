/**
 * tx-tool — transcript row for a tool invocation. Click to expand the row
 * into a pretty-printed JSON dump of the tool output for debugging.
 *
 * Compact row shows: agent badge + tool name + truncated args + meta
 * (latency, size, provider pill). Errors render in `--c-warn` with the
 * error message replacing the args summary; failed rows aren't expandable.
 * In-progress rows (no output yet) aren't expandable either.
 */
"use client";

import { useState, type ReactElement } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AgentBadge } from "@/components/agent-badge";
import type { AgentName } from "@/flows/analysis/registry";
import { cn } from "@/lib/utils";

export type TxToolProps = {
  agent?: AgentName;
  toolName: string;
  argsPreview: string;
  status: "in_progress" | "completed" | "incomplete" | "failed";
  /** Provider tag from the tool's output (free-form string — trading-desk
   *  tools emit `fixture | yahoo | finnhub | fred | polymarket | unavailable`,
   *  the `fetch` tool from `@flow-state-dev/tools` emits `jina | firecrawl |
   *  builtin`, etc). Display logic groups all non-fixture / non-unavailable
   *  values under the "live" tone but always shows the literal name. */
  source?: string;
  output?: unknown;
  durationMs?: number;
  bytes?: number;
  errorMessage?: string;
};

function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

export function TxTool({
  agent,
  toolName,
  argsPreview,
  status,
  source,
  output,
  durationMs,
  bytes,
  errorMessage,
}: TxToolProps): ReactElement {
  const [open, setOpen] = useState(false);
  const isError = status === "failed";
  const expandable = !isError && output !== undefined;
  const meta = [
    durationMs !== undefined ? `${durationMs}ms` : null,
    bytes !== undefined ? formatBytes(bytes) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Row container is a `<span>` (not `<div>`) so it remains valid HTML5
  // phrasing content when nested inside the expandable `<button>` below.
  // Tailwind's `flex` class sets `display: flex` regardless of element.
  const row = (
    <span className="flex items-center gap-2 px-4 py-1 text-[12px]">
      {expandable ? (
        open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-[color:var(--c-fg-faint)]" aria-hidden />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-[color:var(--c-fg-faint)]" aria-hidden />
        )
      ) : (
        <span className="inline-block h-3 w-3 shrink-0" aria-hidden />
      )}
      {agent !== undefined ? (
        <AgentBadge agent={agent} treatment="medium" />
      ) : (
        <span className="inline-block h-4 w-4" aria-hidden />
      )}
      <span className="font-mono text-[color:var(--c-accent-2)]">{toolName}</span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-mono text-[11px]",
          isError ? "text-[color:var(--c-warn)]" : "text-[color:var(--c-fg-muted)]",
        )}
        title={isError ? errorMessage : argsPreview}
      >
        {isError ? errorMessage ?? "tool failed" : argsPreview}
      </span>
      {meta !== "" && (
        <span className="font-mono text-[10.5px] text-[color:var(--c-fg-faint)]">
          {meta}
        </span>
      )}
      {source !== undefined && <SourcePill source={source} />}
    </span>
  );

  if (!expandable) return row;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="block w-full text-left hover:bg-white/[0.02]"
        aria-expanded={open}
      >
        {row}
      </button>
      {open && (
        <pre
          className={cn(
            "mx-4 mt-0.5 mb-1 max-h-[360px] overflow-auto rounded border px-3 py-2",
            "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
            "font-mono text-[11px] leading-snug text-[color:var(--c-fg-muted)]",
          )}
        >
          {JSON.stringify(output, null, 2)}
        </pre>
      )}
    </div>
  );
}

/**
 * Source tag pill. Three visual tones:
 *   - `fixture`     → uses `--c-fixture` (curated data, not live).
 *   - `unavailable` → muted gray (live mode but no provider answered).
 *   - everything else → `--c-live`. Pill text shows the literal provider
 *     name so the analyst can distinguish providers without color coding.
 */
function SourcePill({ source }: { source: string }): ReactElement {
  const tone =
    source === "fixture" ? "fixture" : source === "unavailable" ? "unavailable" : "live";
  return (
    <span
      className={cn(
        "rounded px-1.5 py-px font-mono text-[9.5px] uppercase tracking-wider",
        tone === "fixture" && "bg-[color:var(--c-fixture)]/15 text-[color:var(--c-fixture)]",
        tone === "live" && "bg-[color:var(--c-live)]/15 text-[color:var(--c-live)]",
        tone === "unavailable" &&
          "bg-[color:var(--c-fg-faint)]/15 text-[color:var(--c-fg-faint)]",
      )}
    >
      {source.toUpperCase()}
    </span>
  );
}
