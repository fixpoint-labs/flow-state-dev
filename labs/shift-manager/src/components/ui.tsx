/**
 * Shift Manager's small shared pieces: the named empty state, a failed section with
 * Retry, tabs whose selection lives in the URL, a worker's status mark, and
 * the parts of design v2's look every screen draws with: a screen's title,
 * mono meta text, and a task's state square.
 *
 * Every piece is square (v2 draws no rounded corner) and paints only tokens.
 */
import type { ReactNode } from "react";
import type { Column } from "../lib/columns";
import type { ShiftStatus } from "../lib/derive";
import type { Failure } from "../lib/reads";
import { cn } from "../lib/utils";

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
    <div className="border border-destructive/40 px-3 py-2 text-xs" role="alert" data-testid={testId ?? "section-failure"}>
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

/**
 * Tabs; the selected one is whatever the route says. Drawn as v2's (v2:220-223):
 * mono 12px, the selected one on a 2px blue underline, and a count beside a
 * tab when the caller gives one.
 */
export function Tabs<T extends string>({
  tabs,
  selected,
  onSelect,
  label,
  counts,
}: {
  tabs: readonly T[];
  selected: T;
  onSelect: (tab: T) => void;
  label: string;
  /** A number drawn beside a tab's name, by tab. */
  counts?: Partial<Record<T, number>>;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-[22px] border-b px-[22px] font-mono text-xs font-medium" data-look="tabs">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={tab === selected}
          data-tab={tab}
          onClick={() => onSelect(tab)}
          className={`-mb-px border-b-2 py-2 capitalize ${
            tab === selected ? "border-info text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab}
          {counts?.[tab] === undefined ? null : (
            <span className="ml-1.5 text-muted-foreground" data-testid={`tab-count-${tab}`}>
              {counts[tab]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * A screen's title at v2's scale: 18px/700 on a screen (v2:215, 364, 509, 562,
 * 653, 696), 22px on Chief of Staff (v2:127). `detail` is the 26px heading of
 * a pane inside a screen, Inbox's selected ask (v2:597), drawn as an `h2`
 * under the screen's own title.
 */
export function ScreenTitle({ children, scale = "screen", testId }: { children: ReactNode; scale?: "screen" | "cos" | "detail"; testId?: string }) {
  if (scale === "detail") {
    return (
      <h2 className="text-[26px] leading-[1.15] font-bold tracking-[-0.03em]" data-look="detail-title" data-testid={testId}>
        {children}
      </h2>
    );
  }
  return (
    <h1
      className={`font-bold ${scale === "cos" ? "text-[22px] tracking-[-0.03em]" : "text-lg tracking-[-0.02em]"}`}
      data-look="screen-title"
      data-testid={testId}
    >
      {children}
    </h1>
  );
}

/** v2's mono sizes, by what the text is (v2:30, 42, 60, 74, 107, 220). */
const META_SIZE = {
  /** A section label: PROJECTS, TEAMS (10px, spaced caps). */
  label: "text-[10px] tracking-[0.14em]",
  /** A count beside a name (10.5px). */
  count: "text-[10.5px]",
  /** A meta line, a footer, an id (11px). */
  meta: "text-[11px]",
  /** A control's text: a tab, a field, a button (12px). */
  control: "text-xs",
} as const;

/**
 * Mono meta text: a label, count, id, time, meta line or control, in IBM Plex
 * Mono at v2's size for that role. Everything else on a screen is the sans.
 */
export function Meta({
  children,
  role = "meta",
  className,
  testId,
}: {
  children: ReactNode;
  role?: keyof typeof META_SIZE;
  className?: string;
  testId?: string;
}) {
  return (
    <span className={cn("font-mono font-medium", META_SIZE[role], className)} data-look={`meta-${role}`} data-testid={testId}>
      {children}
    </span>
  );
}

/** v2's state square states (`NODE`, v2:893-896). */
export type TaskState = "needs" | "run" | "review" | "queued" | "done";

/** The state square a board column draws its rows with. */
export const STATE_OF_COLUMN: Record<Column, TaskState> = {
  QUEUED: "queued",
  RUNNING: "run",
  "NEEDS YOU": "needs",
  "IN REVIEW": "review",
  DONE: "done",
};

const STATE_SQUARE: Record<TaskState, string> = {
  // The highlighter, only because the row waits on a person.
  needs: "border-solid border-foreground bg-attention",
  run: "border-solid border-info bg-info",
  review: "border-solid border-info",
  queued: "border-dashed border-foreground/50",
  done: "border-solid border-foreground bg-foreground",
};

/** A task's state as v2's 8px square (v2:893-896): needs, run, review, queued or done. */
export function StateSquare({ state, className }: { state: TaskState; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 border", STATE_SQUARE[state], className)} data-state-square={state} aria-hidden />;
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
