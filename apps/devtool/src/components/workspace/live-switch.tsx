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
import { cn } from "@/lib/utils";
import type { LiveStatus } from "@/hooks/use-live-mode";

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
    dotClass: "bg-green-400 animate-pulse",
    textClass: "text-green-300",
  },
  polling: {
    label: "Polling",
    dotClass: "bg-amber-400 animate-pulse",
    textClass: "text-amber-300",
  },
  complete: {
    label: "Complete",
    dotClass: "bg-emerald-500",
    textClass: "text-emerald-300",
    icon: "check",
  },
  failed: {
    label: "Failed",
    dotClass: "bg-red-500",
    textClass: "text-red-300",
    icon: "cross",
  },
  idle: {
    label: "Idle",
    dotClass: "bg-slate-500",
    textClass: "text-slate-400",
  },
  off: {
    label: "Off",
    dotClass: "bg-slate-700",
    textClass: "text-slate-500",
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
            "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors",
            on
              ? "border-green-500/40 bg-green-500/30"
              : "border-slate-700 bg-slate-800",
            disabled ? "cursor-not-allowed opacity-90" : "cursor-pointer",
          )}
        >
          <span
            className={cn(
              "inline-block h-3 w-3 transform rounded-full bg-slate-100 shadow transition-transform",
              on ? "translate-x-3.5" : "translate-x-0.5",
            )}
          />
        </button>
      )}
      <span className="inline-flex items-center gap-1 text-[10px] font-medium">
        <span className={cn("inline-block h-1.5 w-1.5 rounded-full", pres.dotClass)} />
        <span className={pres.textClass}>{pres.label}</span>
        {pres.icon === "check" && <Check className={cn("h-3 w-3", pres.textClass)} />}
        {pres.icon === "cross" && <X className={cn("h-3 w-3", pres.textClass)} />}
      </span>
    </div>
  );
}
