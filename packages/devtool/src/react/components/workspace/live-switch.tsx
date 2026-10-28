/**
 * Live updates control. Two visual parts:
 *   - A real switch slider (track + thumb) that surfaces the user preference.
 *   - A status pill that reflects what the system is actually doing right
 *     now: Live (streaming), Polling, Complete, Failed, Idle, or Off.
 *
 * The switch is locked ON while a user-dispatched request is streaming,
 * because we always SSE-subscribe to those.
 */
import { Check, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type { LiveStatus } from "../../hooks/use-live-mode";

type LiveSwitchProps = {
  on: boolean;
  disabled?: boolean;
  status: LiveStatus;
  /**
   * Whether to render the slider control. The status badge is always shown
   * (it's informational); the slider only appears when the user has something
   * to act on — typically when polling is running or live mode is off and a
   * request is still active.
   */
  showToggle?: boolean;
  onToggle: () => void;
};

type StatusPresentation = {
  label: string;
  dotClass: string;
  textClass: string;
  icon?: "check" | "cross" | null;
};

const PRESENTATIONS: Record<LiveStatus, StatusPresentation> = {
  streaming: {
    label: "Live",
    dotClass: "bg-fs-blue animate-pulse",
    textClass: "text-fs-blue",
  },
  polling: {
    label: "Polling",
    dotClass: "bg-fs-blue/50 animate-pulse",
    textClass: "text-fs-ink2",
  },
  complete: {
    label: "Complete",
    dotClass: "bg-fs-green",
    textClass: "text-fs-green",
    icon: "check",
  },
  failed: {
    label: "Failed",
    dotClass: "bg-fs-red",
    textClass: "text-fs-red",
    icon: "cross",
  },
  idle: {
    label: "Idle",
    dotClass: "border border-dashed border-fs-ink3",
    textClass: "text-fs-ink3",
  },
  off: {
    label: "Off",
    dotClass: "border border-fs-ink5",
    textClass: "text-fs-ink4",
  },
};

export function LiveSwitch({ on, disabled, status, showToggle, onToggle }: LiveSwitchProps) {
  const pres = PRESENTATIONS[status];
  const tooltip = disabled
    ? "Auto-streaming a dispatched request — locked on"
    : showToggle
      ? on
        ? status === "polling"
          ? "Live mode on — SSE unavailable, polling every 2s"
          : "Live mode on"
        : "Live mode off — click to enable"
      : pres.label;

  return (
    <div className="inline-flex items-center gap-2" title={tooltip}>
      {showToggle && (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Live updates"
          disabled={disabled}
          onClick={onToggle}
          className={cn(
            "relative inline-flex h-4 w-7 shrink-0 items-center border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fs-blue/40",
            on
              ? "border-fs-blue bg-fs-blue/15"
              : "border-fs-ink/30 bg-fs-paper",
            disabled ? "cursor-not-allowed opacity-90" : "cursor-pointer",
          )}
        >
          <span
            className={cn(
              "inline-block h-2.5 w-2.5 transform transition-transform",
              on ? "translate-x-[15px] bg-fs-blue" : "translate-x-[3px] bg-fs-ink3",
            )}
          />
        </button>
      )}
      <span className="inline-flex items-center gap-1.5 font-fs-mono text-[10.5px] font-medium">
        <span className={cn("inline-block size-[7px] shrink-0 box-border", pres.dotClass)} />
        <span className={pres.textClass}>{pres.label}</span>
        {pres.icon === "check" && <Check className={cn("h-3 w-3", pres.textClass)} />}
        {pres.icon === "cross" && <X className={cn("h-3 w-3", pres.textClass)} />}
      </span>
    </div>
  );
}
