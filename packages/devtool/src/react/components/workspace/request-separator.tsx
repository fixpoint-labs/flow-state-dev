/**
 * Simplified request header.
 * Shows: action name + status pill + duration.
 * Request ID and replay/cursor/reconnect controls behind overflow menu.
 */
import { useState } from "react";
import { MoreHorizontal, Play, SkipForward, RefreshCw } from "lucide-react";
import { StatusBadge } from "../shared/status-badge";
import { Button } from "../ui/button";
import { useDebug } from "../../context/debug-context";
import { formatTokenCount } from "../../lib/token-utils";

type RequestSeparatorProps = {
  requestId: string;
  action: string;
  status: string;
  duration?: number;
  isActive?: boolean;
  totalTokens?: number;
  /** Inbound transport that produced the request. Undefined for legacy data. */
  source?: string;
  /**
   * Adapter-stamped provenance bag. Scheduled requests carry
   * `scheduleId` (string) and `origin` (`"static" | "dynamic"`); other
   * sources may carry their own keys without affecting rendering here.
   */
  metadata?: Record<string, unknown>;
  onReplayFull?: () => void;
  onReplayFromCursor?: () => void;
  onReconnect?: () => void;
};

/** Visual styling for the scheduled `origin` badge — small, secondary. */
const ORIGIN_BADGE_CLASSNAMES: Record<string, string> = {
  static: "border-slate-600 text-slate-400",
  dynamic: "border-cyan-700 text-cyan-300"
};

const SCHEDULE_ID_DISPLAY_LIMIT = 32;

function truncateMiddle(value: string, max: number): string {
  if (value.length <= max) return value;
  const half = Math.floor((max - 1) / 2);
  return `${value.slice(0, half)}…${value.slice(-half)}`;
}

/**
 * Visual treatment per known transport source. Unknown values render as
 * a generic badge so custom transports still surface — the framework does
 * not police namespacing (FIX-438 §3.5).
 */
const SOURCE_LABELS: Record<string, { label: string; className: string }> = {
  mcp: { label: "MCP", className: "border-purple-700 text-purple-300" },
  webhook: { label: "Webhook", className: "border-amber-700 text-amber-300" },
  scheduled: { label: "Scheduled", className: "border-cyan-700 text-cyan-300" },
  notification: { label: "Notification", className: "border-fuchsia-700 text-fuchsia-300" }
};

function formatDuration(ms?: number, isActive?: boolean): string {
  if (ms === undefined || ms === null) return isActive ? "0.0s…" : "";
  const seconds = ms / 1000;
  return isActive ? `${seconds.toFixed(1)}s…` : `${seconds.toFixed(1)}s`;
}

export function RequestSeparator({
  requestId,
  action,
  status,
  duration,
  isActive,
  totalTokens,
  source,
  metadata,
  onReplayFull,
  onReplayFromCursor,
  onReconnect,
}: RequestSeparatorProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const { isDebugMode } = useDebug();
  const showReplayControls = status === "completed" || status === "failed";
  const hasOverflow = showReplayControls || isDebugMode;
  const durationText = formatDuration(duration, isActive);

  // Scheduled requests carry first-class provenance (`scheduleId`,
  // `origin`) — surface as a suffix on the source chip and a secondary
  // origin badge so operators can tell static cron jobs apart from
  // user/agent-created dynamic schedules at a glance.
  const scheduleId =
    source === "scheduled" && typeof metadata?.scheduleId === "string"
      ? metadata.scheduleId
      : undefined;
  const origin =
    source === "scheduled" && (metadata?.origin === "static" || metadata?.origin === "dynamic")
      ? metadata.origin
      : undefined;
  const sourceChipText = (() => {
    const baseLabel = source !== undefined ? (SOURCE_LABELS[source]?.label ?? source) : "";
    if (scheduleId === undefined) return baseLabel;
    return `${baseLabel} · ${truncateMiddle(scheduleId, SCHEDULE_ID_DISPLAY_LIMIT)}`;
  })();

  // Show a "Provenance" affordance for non-default sources so operators
  // can drill into source/origin/scheduleId/cron/nominalFireTime without
  // needing a custom panel. The chip is clickable for non-http sources.
  const hasProvenanceDetails =
    source !== undefined && source !== "http" && metadata !== undefined;

  return (
    <div className="sticky top-0 z-10 select-none border-b border-slate-800/40 bg-slate-950/95 backdrop-blur-sm">
    <div className="flex items-center gap-2 px-4 py-1.5">
      <span className="text-xs font-medium text-slate-300">{action}</span>
      <StatusBadge status={status} />
      {source !== undefined && source !== "http" && (
        <button
          type="button"
          className={`rounded border px-1.5 py-0 text-[10px] font-medium hover:opacity-80 ${
            SOURCE_LABELS[source]?.className ?? "border-slate-700 text-slate-400"
          }`}
          title={
            hasProvenanceDetails
              ? `Source: ${source}${scheduleId !== undefined ? ` · ${scheduleId}` : ""} — click for provenance`
              : `Source: ${source}`
          }
          onClick={() => setProvenanceOpen((open) => !open)}
          disabled={!hasProvenanceDetails}
        >
          {sourceChipText}
        </button>
      )}
      {origin !== undefined && (
        <span
          className={`rounded border px-1.5 py-0 text-[10px] font-medium ${ORIGIN_BADGE_CLASSNAMES[origin]}`}
          title={`Schedule origin: ${origin}`}
        >
          {origin}
        </span>
      )}
      {durationText && (
        <span className="text-[11px] text-slate-500 font-mono tabular-nums">{durationText}</span>
      )}
      {totalTokens !== undefined && totalTokens > 0 && (
        <span className="text-[10px] text-slate-600 font-mono tabular-nums">
          {formatTokenCount(totalTokens)} tok
        </span>
      )}

      <span className="flex-1" />

      {isDebugMode && (
        <span className="text-[10px] font-mono text-slate-700">{requestId.slice(0, 10)}</span>
      )}

      {hasOverflow && (
        <div className="relative">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-slate-600 hover:text-slate-400"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            title="More actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>

          {menuOpen && (
            <>
              {/* Click-away backdrop */}
              <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-30 mt-1 min-w-[140px] rounded-md border border-slate-800 bg-slate-900 py-1 shadow-lg">
                {isDebugMode && (
                  <div className="px-3 py-1.5 text-[10px] font-mono text-slate-600 select-all border-b border-slate-800/50">
                    {requestId}
                  </div>
                )}
                {onReplayFull && (
                  <OverflowButton icon={<Play className="h-3 w-3" />} label="Replay" onClick={() => { setMenuOpen(false); onReplayFull(); }} />
                )}
                {onReplayFromCursor && (
                  <OverflowButton icon={<SkipForward className="h-3 w-3" />} label="From cursor" onClick={() => { setMenuOpen(false); onReplayFromCursor(); }} />
                )}
                {onReconnect && (
                  <OverflowButton icon={<RefreshCw className="h-3 w-3" />} label="Reconnect" onClick={() => { setMenuOpen(false); onReconnect(); }} />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
    {provenanceOpen && hasProvenanceDetails && (
      <ProvenanceDetails source={source!} metadata={metadata!} />
    )}
    </div>
  );
}

/**
 * Expandable provenance section. Renders source, origin (when scheduled),
 * and the full adapter-stamped metadata bag. Hidden by default — opens
 * when the user clicks the source chip on the request separator.
 */
function ProvenanceDetails({
  source,
  metadata,
}: {
  source: string;
  metadata: Record<string, unknown>;
}) {
  const entries: Array<[string, unknown]> = [["source", source]];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue;
    entries.push([key, value]);
  }

  return (
    <div className="border-t border-slate-800/40 bg-slate-950/70 px-4 py-2">
      <div className="text-[10px] font-medium uppercase text-slate-500 mb-1">Provenance</div>
      <div className="space-y-0.5 text-[11px]">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-start justify-between gap-2">
            <span className="text-slate-500 shrink-0 font-mono">{key}</span>
            <span className="text-slate-300 text-right break-all font-mono">
              {formatProvenanceValue(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatProvenanceValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function OverflowButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
