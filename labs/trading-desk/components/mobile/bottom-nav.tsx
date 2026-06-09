/**
 * BottomNav — the mobile shell's primary navigation (FIX-757): a single-row
 * bottom tab bar with four surface tabs (Report, Transcript, Portfolio,
 * History) and a centered, accent-filled "New" ACTION slot that opens the New
 * Analysis sheet without ever becoming the active tab.
 *
 * Rendered only in the mobile shell (`lg:hidden` lives on the shell, not
 * here). The bar pads its bottom edge with `env(safe-area-inset-bottom)` so
 * the buttons clear the iOS home indicator (`viewport-fit=cover` is set in
 * `app/layout.tsx`).
 */
"use client";

import type { ReactElement } from "react";
import { Activity, Briefcase, Clock, FileText, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** The four mobile surfaces. "New" is deliberately NOT in this union — it is
 *  an action (opens the New Analysis sheet), not a destination. */
export type MobileTab = "report" | "transcript" | "portfolio" | "history";

type BottomNavProps = {
  active: MobileTab;
  onSelect: (tab: MobileTab) => void;
  /** Opens the New Analysis sheet. Never changes the active tab. */
  onNewAnalysis: () => void;
};

/** Tab slots either side of the New action, in render order. */
const LEFT_TABS: ReadonlyArray<{
  value: MobileTab;
  label: string;
  Icon: typeof FileText;
}> = [
  { value: "report", label: "Report", Icon: FileText },
  { value: "transcript", label: "Transcript", Icon: Activity },
];
const RIGHT_TABS: ReadonlyArray<{
  value: MobileTab;
  label: string;
  Icon: typeof FileText;
}> = [
  { value: "portfolio", label: "Portfolio", Icon: Briefcase },
  { value: "history", label: "History", Icon: Clock },
];

export function BottomNav({
  active,
  onSelect,
  onNewAnalysis,
}: BottomNavProps): ReactElement {
  return (
    <nav
      aria-label="Trading desk surfaces"
      className={cn(
        "flex items-stretch border-t",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      {LEFT_TABS.map((t) => (
        <TabButton key={t.value} {...t} active={active} onSelect={onSelect} />
      ))}
      <button
        type="button"
        onClick={onNewAnalysis}
        aria-label="New analysis"
        className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5"
      >
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full",
            "bg-[color:var(--c-accent)] text-white",
          )}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </span>
        <span className="text-[9.5px] font-medium text-[color:var(--c-fg-muted)]">
          New
        </span>
      </button>
      {RIGHT_TABS.map((t) => (
        <TabButton key={t.value} {...t} active={active} onSelect={onSelect} />
      ))}
    </nav>
  );
}

function TabButton({
  value,
  label,
  Icon,
  active,
  onSelect,
}: {
  value: MobileTab;
  label: string;
  Icon: typeof FileText;
  active: MobileTab;
  onSelect: (tab: MobileTab) => void;
}): ReactElement {
  const isActive = value === active;
  return (
    <button
      type="button"
      aria-current={isActive ? "page" : undefined}
      onClick={() => {
        if (!isActive) onSelect(value);
      }}
      className={cn(
        "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5",
        isActive
          ? "text-[color:var(--c-accent)]"
          : "text-[color:var(--c-fg-muted)]",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      <span className="text-[9.5px] font-medium">{label}</span>
    </button>
  );
}
