// FIX-2085; FIX-2614.
/**
 * Routines: everything that fires on its own as the user, in one list. A clock
 * routine shows the task it files, on whose board, and when it is next due; an
 * event routine shows the thread it follows and whose conversation hears it.
 * Each says who made it and can be paused, resumed or deleted here; an app's
 * own routine can only be paused. What a clock routine filed is on Tasks like
 * any other task.
 */
import { useState } from "react";
import { EmptyState, Meta, ScreenTitle, SectionFailure } from "../components/ui";
import { workerLabel, type LoadedSnapshot } from "../lib/derive";
import { useRoutines, type Routine, type RoutineChange } from "../lib/routines";

/** When a clock routine is next due, in the page's time zone: weekday, date and 24-hour time. */
export function nextRunLabel(nextRunAt: string | null, paused: boolean): string {
  if (paused) return "paused";
  if (nextRunAt === null) return "no next run";
  return new Date(nextRunAt).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

/** Who made a routine, as the list says it. */
export function madeByLabel(madeBy: Routine["madeBy"]): string {
  if (madeBy === null) return "";
  if (madeBy.by === "user") return "made by you";
  if (madeBy.by === "worker") return `made by ${workerLabel(madeBy.worker)}`;
  return "the app's";
}

function RoutineLine({ routine, change }: { routine: Routine; change: RoutineChange }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const run = (wanted: Parameters<RoutineChange>[0]) => {
    setBusy(true);
    setProblem(undefined);
    void change(wanted).then((why) => {
      setBusy(false);
      setProblem(why);
    });
  };
  const when = routine.clock !== null ? nextRunLabel(routine.clock.nextRunAt, routine.paused) : routine.paused ? "paused" : "on each event";
  const title = routine.description ?? (routine.clock !== null ? (routine.goal ?? routine.name) : (routine.event?.interest ?? routine.name));
  const detail =
    routine.clock !== null
      ? `${workerLabel(routine.worker)}'s board${routine.assignee === null ? "" : ` → ${workerLabel(routine.assignee)}`} · ${routine.clock.cron} · ${routine.clock.timezone}`
      : `${routine.event!.thread}${routine.event!.kinds === null ? "" : ` · ${routine.event!.kinds.join(", ")}`} · heard by ${workerLabel(routine.worker)}`;
  const maker = madeByLabel(routine.madeBy);
  const declared = routine.madeBy?.by === "app";
  return (
    <li
      className="grid grid-cols-[minmax(9rem,max-content)_1fr_max-content] items-baseline gap-x-4 border-b border-foreground/10 py-2"
      data-testid="routine"
      data-id={routine.id}
      data-trigger={routine.clock !== null ? "clock" : "event"}
      data-next-run={routine.clock?.nextRunAt ?? ""}
      data-paused={routine.paused}
    >
      <Meta className={routine.paused ? "text-muted-foreground" : ""} testId="routine-when">
        {when}
      </Meta>
      <span className="min-w-0">
        <span className="block truncate text-sm" data-testid="routine-title" title={title}>
          {title}
        </span>
        <Meta className="block text-muted-foreground" testId="routine-detail">
          {detail}
          {maker === "" ? "" : ` · ${maker}`}
        </Meta>
        {problem === undefined ? null : (
          <Meta className="block text-destructive" testId="routine-problem">
            {problem}
          </Meta>
        )}
      </span>
      <span className="flex gap-2 text-xs">
        <button
          type="button"
          className="border border-foreground/30 px-2 py-0.5"
          disabled={busy}
          onClick={() => run({ pause: routine.id, paused: !routine.paused })}
          data-testid="routine-pause"
        >
          {routine.paused ? "Resume" : "Pause"}
        </button>
        {declared ? null : (
          <button type="button" className="border border-foreground/30 px-2 py-0.5" disabled={busy} onClick={() => run({ delete: routine.id })} data-testid="routine-delete">
            Delete
          </button>
        )}
      </span>
    </li>
  );
}

export function Routines({ snapshot }: { snapshot: LoadedSnapshot }) {
  const { routines, failure, reread, change } = useRoutines(snapshot.readAt);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="routines">
      <header className="border-b border-foreground/20 px-[22px] py-3.5" data-testid="routines-header">
        <ScreenTitle>Routines</ScreenTitle>
        <Meta role="control" className="mt-1 block text-muted-foreground" testId="routines-summary">
          {routines === undefined
            ? "Reading…"
            : routines === null
              ? "This Lab keeps no routines."
              : `${routines.length} ${routines.length === 1 ? "routine runs" : "routines run"} as you: on a clock, soonest first, then on an event.`}
        </Meta>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-3">
        {failure !== undefined ? (
          <SectionFailure what="Routines" failure={failure} onRetry={reread} testId="routines-failure" />
        ) : routines === null ? (
          <EmptyState title="No routines" testId="routines-empty">
            This Lab keeps no roster for you, so it keeps no routines.
          </EmptyState>
        ) : routines === undefined ? (
          <p className="text-sm text-muted-foreground" data-testid="routines-reading">
            Reading routines…
          </p>
        ) : routines.length === 0 ? (
          <EmptyState title="No routines yet" testId="routines-empty">
            A routine runs as you on its own: on a clock it files a task on a worker's board, on an event a worker's conversation hears it. Ask a worker, or save one, and it shows here.
          </EmptyState>
        ) : (
          <ol data-testid="routine-list">
            {routines.map((routine) => (
              <RoutineLine key={routine.id} routine={routine} change={change} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
