/**
 * Simplified request header — the stream's run row.
 * Shows: action name + status square + duration, on a hairline top rule.
 * Request ID and replay/cursor/reconnect controls behind overflow menu.
 */
import { useState } from "react";
import { MoreHorizontal, Play, SkipForward, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "../ui/button";
import { useDebug } from "../../context/debug-context";
import { formatTokenCount } from "../../lib/token-utils";
import { cn } from "../../lib/utils";

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
   * Adapter-stamped provenance bag. Event transports namespace their
   * coordinate under a single slot — scheduled requests carry
   * `metadata.schedule.{scheduleId, origin, …}`, webhooks
   * `metadata.webhook.{provider, eventType}` (FIX-838). Other sources
   * may carry their own keys without affecting rendering here.
   */
  metadata?: Record<string, unknown>;
  onReplayFull?: () => void;
  onReplayFromCursor?: () => void;
  onReconnect?: () => void;
  onContinue?: () => void;
  /** True while a continuation is already streaming for this request (FIX-865). */
  isContinuing?: boolean;
};

/** Tag treatment shared by the source chip and the origin badge. */
const TAG_CLASSNAME =
  "border px-1 font-fs-mono text-[9.5px] font-medium uppercase tracking-[.08em]";

/** Visual styling for the scheduled `origin` badge — small, secondary. */
const ORIGIN_BADGE_CLASSNAMES: Record<string, string> = {
  static: "border-dashed border-fs-ink/45 text-fs-ink3",
  dynamic: "border-fs-ink/45 text-fs-ink2"
};

/**
 * Square status glyph class for a request / block / suspension status.
 * Meaning, not hue: done → green, running → blue, failed → red, waiting on a
 * person → highlighter, anything else (skipped / pending / unknown) → dashed.
 * Shared with the trace view so both surfaces read the same legend.
 */
export function statusSquareClass(status: string | undefined): string {
  switch (status) {
    case "completed":
    case "approved":
    case "submitted":
      return "bg-fs-green";
    case "in_progress":
    case "finishing":
      return "bg-fs-blue";
    case "failed":
    case "rejected":
    case "interrupted":
    case "timed_out":
      return "bg-fs-red";
    case "suspended":
      return "bg-fs-hl";
    default:
      return "border border-dashed border-fs-ink3";
  }
}

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
const SOURCE_LABELS: Record<string, { label: string }> = {
  mcp: { label: "MCP" },
  webhook: { label: "Webhook" },
  scheduled: { label: "Scheduled" },
  notification: { label: "Notification" }
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
  onContinue,
  isContinuing,
}: RequestSeparatorProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const { isDebugMode } = useDebug();
  const showReplayControls = status === "completed" || status === "failed";
  const durationText = formatDuration(duration, isActive);

  // Scheduled requests carry first-class provenance under the namespaced
  // `metadata.schedule` slot (`scheduleId`, `origin`; FIX-838) — surface as a
  // suffix on the source chip and a secondary origin badge so operators can
  // tell static cron jobs apart from user/agent-created dynamic schedules at a
  // glance.
  const scheduleMeta = metadata?.schedule as
    | { scheduleId?: unknown; origin?: unknown }
    | undefined;
  const scheduleId =
    source === "scheduled" && typeof scheduleMeta?.scheduleId === "string"
      ? scheduleMeta.scheduleId
      : undefined;
  const origin =
    source === "scheduled" &&
    (scheduleMeta?.origin === "static" || scheduleMeta?.origin === "dynamic")
      ? scheduleMeta.origin
      : undefined;

  // Crash-recovery continuation (FIX-865): only for a run the server actually
  // marked interrupted, and only when the source isn't webhook — the
  // `/continue` route rejects webhook-sourced requests server-side, so this
  // client-side gate avoids a guaranteed 404 from the menu. A dynamic
  // schedule's handler core is carried only on its original dispatch
  // envelope (`resolveActionCore` can re-resolve only `flow.schedules.static`
  // on recovery), so it also can't be re-entered — gate on `origin` too.
  const showContinue =
    status === "interrupted" &&
    source !== "webhook" &&
    origin !== "dynamic" &&
    !isContinuing;
  const hasOverflow = showReplayControls || showContinue || isDebugMode;
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
    <div className="sticky top-0 z-10 select-none border-t border-fs-ink/12 bg-fs-surface">
    <div className="flex items-center gap-3 px-4 pb-1.5 pt-3">
      <span className="font-fs-mono text-[12px] font-semibold text-fs-ink">{action}</span>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 font-fs-mono text-[11px] font-medium",
          status === "failed" ? "text-fs-red" : "text-fs-ink2",
        )}
      >
        <span className={cn("inline-block size-[7px] shrink-0 box-border", statusSquareClass(status))} />
        {status}
      </span>
      {source !== undefined && source !== "http" && (
        <button
          type="button"
          className={cn(TAG_CLASSNAME, "border-fs-ink/45 text-fs-ink3 hover:border-fs-ink hover:text-fs-ink disabled:hover:border-fs-ink/45 disabled:hover:text-fs-ink3")}
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
          className={cn(TAG_CLASSNAME, ORIGIN_BADGE_CLASSNAMES[origin])}
          title={`Schedule origin: ${origin}`}
        >
          {origin}
        </span>
      )}
      {durationText && (
        <span className="font-fs-mono text-[11px] font-medium tabular-nums text-fs-ink3">{durationText}</span>
      )}
      {totalTokens !== undefined && totalTokens > 0 && (
        <span className="font-fs-mono text-[11px] font-medium tabular-nums text-fs-ink4">
          {formatTokenCount(totalTokens)} tok
        </span>
      )}

      <span className="flex-1" />

      {isDebugMode && (
        <span className="font-fs-mono text-[10px] text-fs-ink4">{requestId.slice(0, 10)}</span>
      )}

      {hasOverflow && (
        <div className="relative">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-fs-ink4 hover:text-fs-ink"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            title="More actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>

          {menuOpen && (
            <>
              {/* Click-away backdrop */}
              <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-30 mt-1 min-w-[140px] border border-fs-ink/20 bg-fs-card py-1">
                {isDebugMode && (
                  <div className="select-all border-b border-fs-ink/12 px-3 py-1.5 font-fs-mono text-[10px] text-fs-ink4">
                    {requestId}
                  </div>
                )}
                {(showReplayControls || isDebugMode) && onReplayFull && (
                  <OverflowButton icon={<Play className="h-3 w-3" />} label="Replay" onClick={() => { setMenuOpen(false); onReplayFull(); }} />
                )}
                {(showReplayControls || isDebugMode) && onReplayFromCursor && (
                  <OverflowButton icon={<SkipForward className="h-3 w-3" />} label="From cursor" onClick={() => { setMenuOpen(false); onReplayFromCursor(); }} />
                )}
                {(showReplayControls || isDebugMode) && onReconnect && (
                  <OverflowButton icon={<RefreshCw className="h-3 w-3" />} label="Reconnect" onClick={() => { setMenuOpen(false); onReconnect(); }} />
                )}
                {showContinue && onContinue && (
                  <OverflowButton icon={<RotateCcw className="h-3 w-3" />} label="Continue" onClick={() => { setMenuOpen(false); onContinue(); }} />
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
    // Event transports namespace their coordinate under a single slot
    // (`metadata.webhook` / `metadata.schedule`; FIX-838).
    // Flatten it so operators see `scheduleId`, `cron`, `eventType`, … as
    // individual rows rather than one JSON blob.
    if ((key === "webhook" || key === "schedule") &&
        value !== null && typeof value === "object") {
      for (const [innerKey, innerValue] of Object.entries(value)) {
        if (innerValue === undefined) continue;
        entries.push([innerKey, innerValue]);
      }
      continue;
    }
    entries.push([key, value]);
  }

  return (
    <div className="mx-4 mb-2 border border-fs-ink/20 bg-fs-card px-3 py-2">
      <div className="mb-1 font-fs-mono text-[10px] font-medium uppercase tracking-[.14em] text-fs-ink3">Provenance</div>
      <div className="space-y-0.5 font-fs-mono text-[11px]">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-start justify-between gap-2">
            <span className="shrink-0 text-fs-ink4">{key}</span>
            <span className="break-all text-right text-fs-ink2">
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
      className="flex w-full items-center gap-2 px-3 py-1.5 font-fs-mono text-[11px] text-fs-ink3 hover:bg-fs-ink/5 hover:text-fs-ink"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
