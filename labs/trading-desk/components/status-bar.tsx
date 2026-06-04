/**
 * StatusBar — 28px chrome at the bottom of the page.
 *
 * Renders: pulse dot, run state, event count, cost preset, and the
 * load-bearing disclaimer (with `Research / demo only.` bolded in
 * --c-warn). The disclaimer is non-dismissable per phase requirements.
 */
import type { ReactElement } from "react";
import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";

type StatusBarProps = {
  state: "idle" | "streaming" | "complete" | "error";
  eventCount: number;
  expectedEvents?: number;
  preset: "fast" | "full";
  /** Phase 6 thesis-audit badge text. `undefined` when no thesis was provided
   *  for this run (no badge rendered); the alignment verdict once the audit
   *  publishes; `"pending"` while the run is still in flight. */
  thesis?: string;
  /** Soft warning when a thesis was provided but too short to audit, so
   *  Phase 6 was skipped. Surfaced so the user understands why no audit ran. */
  thesisWarning?: string;
  /** Number of non-empty special-instruction fields. Surfaces as
   *  `instructions: N active` next to the gear (FIX-603). */
  activeInstructionCount: number;
  /** Opens the settings dialog. */
  onOpenSettings: () => void;
  /** When true, the gear is rendered disabled with an explanatory tooltip.
   *  Set true when no sessions exist yet — `useResource` needs a session
   *  snapshot to read the user-scope state. */
  settingsDisabled: boolean;
};

const stateLabels: Record<StatusBarProps["state"], string> = {
  idle: "idle",
  streaming: "streaming",
  complete: "complete",
  error: "error",
};

export function StatusBar({
  state,
  eventCount,
  expectedEvents,
  preset,
  thesis,
  thesisWarning,
  activeInstructionCount,
  onOpenSettings,
  settingsDisabled,
}: StatusBarProps): ReactElement {
  const isStreaming = state === "streaming";
  const isError = state === "error";

  return (
    <footer
      className={cn(
        "flex h-7 items-center gap-3 px-4",
        "border-t border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
        "text-[10.5px] text-[color:var(--c-fg-muted)]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          isStreaming && "td-pulse",
        )}
        style={{
          background: isError
            ? "var(--c-warn)"
            : isStreaming
              ? "var(--c-pulse)"
              : "var(--c-fg-faint)",
        }}
      />
      <span className="font-mono">{stateLabels[state]}</span>
      <span className="text-[color:var(--c-fg-faint)]">·</span>
      <span className="font-mono">
        {eventCount}
        {expectedEvents !== undefined ? `/${expectedEvents}` : ""} events
      </span>
      <span className="text-[color:var(--c-fg-faint)]">·</span>
      <span className="font-mono">preset: {preset}</span>
      <span className="text-[color:var(--c-fg-faint)]">·</span>
      {thesis !== undefined ? (
        <>
          <span className="font-mono">Thesis: {thesis}</span>
          <span className="text-[color:var(--c-fg-faint)]">·</span>
        </>
      ) : null}
      {thesis === undefined && thesisWarning !== undefined ? (
        <>
          <span className="font-mono" style={{ color: "var(--c-warn)" }} title={thesisWarning}>
            Thesis: skipped
          </span>
          <span className="text-[color:var(--c-fg-faint)]">·</span>
        </>
      ) : null}
      <button
        type="button"
        onClick={onOpenSettings}
        disabled={settingsDisabled}
        title={
          settingsDisabled
            ? "Run an analysis to enable custom instructions."
            : activeInstructionCount > 0
              ? `${activeInstructionCount} non-empty instruction field${activeInstructionCount === 1 ? "" : "s"} applied`
              : "Open custom instructions"
        }
        className={cn(
          "flex items-center gap-1 rounded px-1 font-mono",
          settingsDisabled
            ? "cursor-not-allowed opacity-50"
            : "hover:bg-[color:var(--c-surface-2)]",
        )}
      >
        <Settings className="h-3 w-3" aria-hidden />
        <span>
          instructions
          {activeInstructionCount > 0 ? `: ${activeInstructionCount} active` : ""}
        </span>
      </button>

      <span className="ml-auto truncate text-right">
        <strong style={{ color: "var(--c-warn)" }}>Research / demo only.</strong>{" "}
        Not financial advice. No execution. Inspired and derived by {" "}
        <span className="font-mono">TauricResearch/TradingAgents</span> positioning.
      </span>
    </footer>
  );
}
