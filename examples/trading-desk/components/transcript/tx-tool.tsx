/**
 * tx-tool — single-line transcript row for a tool invocation.
 *
 * Shows: medium agent badge + tool name + truncated args + meta (latency,
 * size, FIXTURE/LIVE pill). Errors render the same row but in `--c-warn`
 * with the error message replacing the args summary.
 */
import type { ReactElement } from "react";
import { AgentBadge } from "@/components/agent-badge";
import type { AgentName } from "@/src/flows/trading-desk/agents";
import { cn } from "@/lib/utils";

export type TxToolProps = {
  agent?: AgentName;
  toolName: string;
  argsPreview: string;
  status: "in_progress" | "completed" | "incomplete" | "failed";
  source?: "fixture" | "live";
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
  durationMs,
  bytes,
  errorMessage,
}: TxToolProps): ReactElement {
  const isError = status === "failed";
  const meta = [
    durationMs !== undefined ? `${durationMs}ms` : null,
    bytes !== undefined ? formatBytes(bytes) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex items-center gap-2 px-4 py-1 text-[12px]">
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
    </div>
  );
}

function SourcePill({ source }: { source: "fixture" | "live" }): ReactElement {
  const label = source.toUpperCase();
  return (
    <span
      className={cn(
        "rounded px-1.5 py-px font-mono text-[9.5px] uppercase tracking-wider",
        source === "fixture"
          ? "bg-[color:var(--c-fixture)]/15 text-[color:var(--c-fixture)]"
          : "bg-[color:var(--c-live)]/15 text-[color:var(--c-live)]",
      )}
    >
      {label}
    </span>
  );
}
