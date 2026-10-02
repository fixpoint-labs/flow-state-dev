/**
 * Shift Manager's small shared pieces: the named empty state, a failed section with
 * Retry, tabs whose selection lives in the URL, and a worker's status mark.
 */
import type { ReactNode } from "react";
import type { ShiftStatus } from "../lib/derive";
import type { Failure } from "../lib/reads";

/**
 * Where a surface will be, and what arrives there. The copy is the caller's,
 * so the sibling that fills the surface changes a prop, not this component.
 */
export function EmptyState({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <div className="mx-auto max-w-md px-6 py-12 text-center" data-testid={testId ?? "empty-state"}>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/** A section whose read failed: what the Lab said, and Retry. */
export function SectionFailure({
  what,
  failure,
  onRetry,
  testId,
}: {
  what: string;
  failure: Failure;
  onRetry: () => void;
  testId?: string;
}) {
  return (
    <div className="rounded-md border border-destructive/40 px-3 py-2 text-xs" role="alert" data-testid={testId ?? "section-failure"}>
      <p className="font-medium">{what} did not load.</p>
      <p className="mt-0.5 text-muted-foreground">
        {failure.message}
        {failure.httpStatus === undefined ? "" : ` (${failure.httpStatus})`}
      </p>
      <button type="button" className="mt-1.5 font-medium underline underline-offset-2" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

/** Tabs; the selected one is whatever the route says. */
export function Tabs<T extends string>({
  tabs,
  selected,
  onSelect,
  label,
}: {
  tabs: readonly T[];
  selected: T;
  onSelect: (tab: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b px-4">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={tab === selected}
          data-tab={tab}
          onClick={() => onSelect(tab)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm capitalize ${
            tab === selected ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

/**
 * A worker's status mark: solid for on shift, half for on call, an outline
 * for off shift.
 */
export function ShiftMark({ status, className = "size-2" }: { status: ShiftStatus; className?: string }) {
  const fill =
    status === "on shift"
      ? "border-info bg-info"
      : status === "on call"
        ? "border-info bg-[linear-gradient(135deg,var(--color-info)_50%,transparent_50%)]"
        : "border-muted-foreground";
  return <span className={`inline-block shrink-0 border ${fill} ${className}`} data-mark={status} aria-hidden />;
}

/** A worker's status, as its mark and its word. */
export function StatusWord({ status }: { status: ShiftStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="status-word" data-status={status}>
      <ShiftMark status={status} />
      {status}
    </span>
  );
}

/**
 * The mark every screen that draws a status or a count shows when the status
 * result is partial (asks did not load). The words are the caller's.
 */
export function PartialMark({ title }: { title: string }) {
  return (
    <span className="ml-1 border border-dashed border-muted-foreground px-1 text-[10px] text-muted-foreground" title={title} data-testid="partial-mark">
      partial
    </span>
  );
}
