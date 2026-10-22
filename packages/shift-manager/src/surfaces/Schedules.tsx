/**
 * Scheduled work (FIX-2085): the user's schedules, each with the task it files,
 * on whose board, and when it is next due. A fire files an ordinary task, so
 * what a schedule filed is on Tasks like any other.
 */
import { EmptyState, Meta, ScreenTitle, SectionFailure } from "../components/ui";
import { workerLabel, type LoadedSnapshot } from "../lib/derive";
import { projectReaderOf } from "../lib/projects";
import { useScheduledWork, type ScheduledWork } from "../lib/schedules";

/** When a schedule is next due, in the page's time zone: weekday, date and 24-hour time. */
export function nextRunLabel(nextRunAt: string | null, enabled: boolean): string {
  if (!enabled) return "off";
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

function ScheduleLine({ schedule }: { schedule: ScheduledWork }) {
  return (
    <li
      className="grid grid-cols-[minmax(9rem,max-content)_1fr] items-baseline gap-x-4 border-b border-foreground/10 py-2"
      data-testid="schedule"
      data-key={schedule.key}
      data-next-run={schedule.nextRunAt ?? ""}
      data-enabled={schedule.enabled}
    >
      <Meta className={schedule.enabled ? "" : "text-muted-foreground"} testId="schedule-next-run">
        {nextRunLabel(schedule.nextRunAt, schedule.enabled)}
      </Meta>
      <span className="min-w-0">
        <span className="block truncate text-sm" data-testid="schedule-goal" title={schedule.goal ?? schedule.key}>
          {schedule.description ?? schedule.goal ?? schedule.key}
        </span>
        <Meta className="block text-muted-foreground" testId="schedule-detail">
          {schedule.filer === null ? "" : `${workerLabel(schedule.filer)}'s board`}
          {schedule.assignee === null ? "" : ` → ${workerLabel(schedule.assignee)}`}
          {` · ${schedule.cron} · ${schedule.timezone}`}
        </Meta>
      </span>
    </li>
  );
}

export function Schedules({ snapshot }: { snapshot: LoadedSnapshot }) {
  const reader = projectReaderOf(snapshot.sessions);
  const { schedules, failure, reread } = useScheduledWork(reader, snapshot.readAt);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="schedules">
      <header className="border-b border-foreground/20 px-[22px] py-3.5" data-testid="schedules-header">
        <ScreenTitle>Scheduled work</ScreenTitle>
        <Meta role="control" className="mt-1 block text-muted-foreground" testId="schedules-summary">
          {schedules === undefined
            ? "Reading…"
            : `${schedules.length} ${schedules.length === 1 ? "schedule" : "schedules"}, soonest first. Each files a task when it is due.`}
        </Meta>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-3">
        {failure !== undefined ? (
          <SectionFailure what="Scheduled work" failure={failure} onRetry={reread} testId="schedules-failure" />
        ) : reader === null ? (
          <EmptyState title="No scheduled work" testId="schedules-empty">
            This Lab keeps no roster for you, so it keeps no schedules.
          </EmptyState>
        ) : schedules === undefined ? (
          <p className="text-sm text-muted-foreground" data-testid="schedules-reading">
            Reading scheduled work…
          </p>
        ) : schedules.length === 0 ? (
          <EmptyState title="No scheduled work yet" testId="schedules-empty">
            A schedule files a task on a worker's board each time it is due. Saved schedules show here.
          </EmptyState>
        ) : (
          <ol data-testid="schedule-list">
            {schedules.map((schedule) => (
              <ScheduleLine key={schedule.key} schedule={schedule} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
