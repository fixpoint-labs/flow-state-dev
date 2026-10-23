/**
 * Usage (FIX-2141): how much of each coding harness's subscription the user
 * has used, window by window, from the Lab's one usage query.
 *
 * A number is never shown without where it came from and how old it is. A
 * window whose reset has passed shows when it reset instead of its old
 * percent, and a harness with no number (an API key, nobody signed in, a read
 * that failed) says why, with no percent at all.
 */
import { EmptyState, Meta, ScreenTitle, SectionFailure } from "../components/ui";
import type { LoadedSnapshot } from "../lib/derive";
import { ageLabel, harnessName, percentLabel, resetLabel, useHarnessUsage, windowName, type HarnessUsage, type UsageWindow } from "../lib/usage";

function WindowLine({ window }: { window: UsageWindow }) {
  return (
    <li
      className="grid grid-cols-[minmax(9rem,max-content)_1fr] items-baseline gap-x-4 border-b border-foreground/10 py-2"
      data-testid="usage-window"
      data-window-id={window.id}
      data-rolled-over={window.rolledOver}
    >
      <span className="text-sm" data-testid="usage-window-name">
        {windowName(window)}
      </span>
      {window.rolledOver ? (
        <Meta className="text-muted-foreground" testId="usage-rolled-over">
          {window.resetsAt === null ? "reset" : `reset at ${resetLabel(window.resetsAt)}`}, not checked since
        </Meta>
      ) : (
        <span className="flex items-baseline gap-3">
          <Meta role="control" testId="usage-percent">
            {percentLabel(window.usedPercent)}
          </Meta>
          {window.resetsAt === null ? null : (
            <Meta className="text-muted-foreground" testId="usage-reset">
              resets at {resetLabel(window.resetsAt)}
            </Meta>
          )}
        </span>
      )}
    </li>
  );
}

function HarnessCard({ row }: { row: HarnessUsage }) {
  const name = harnessName(row.harness);
  return (
    <section className="border-b border-foreground/20 py-3" data-testid="usage-harness" data-harness={row.harness} data-status={row.status}>
      <header className="flex items-baseline gap-3">
        <h2 className="text-sm font-semibold">{name}</h2>
        {row.plan === null ? null : (
          <Meta className="text-muted-foreground" testId="usage-plan">
            {row.plan}
          </Meta>
        )}
        <Meta className="ml-auto text-muted-foreground" testId="usage-age">
          {row.ageMs === null ? "not checked yet" : `from ${name}, checked ${ageLabel(row.ageMs)}`}
        </Meta>
      </header>
      {row.status === "windows" ? (
        row.windows.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground" data-testid="usage-reason">
            {name} reported no limit windows.
          </p>
        ) : (
          <ul className="mt-1">
            {row.windows.map((window) => (
              <WindowLine key={window.id} window={window} />
            ))}
          </ul>
        )
      ) : (
        <p className="mt-1 text-sm text-muted-foreground" data-testid="usage-reason">
          {row.reason ?? `${name} has no usage to show`}.
        </p>
      )}
      {row.refreshError === null ? null : (
        <Meta className="mt-1 block text-muted-foreground" testId="usage-refresh-error">
          Last refresh failed: {row.refreshError}
        </Meta>
      )}
    </section>
  );
}

export function Usage({ snapshot }: { snapshot: LoadedSnapshot }) {
  const { rows, failure, reread } = useHarnessUsage(snapshot.readAt);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="usage">
      <header className="border-b border-foreground/20 px-[22px] py-3.5">
        <ScreenTitle>Usage</ScreenTitle>
        <Meta role="control" className="mt-1 block text-muted-foreground" testId="usage-summary">
          How much of each coding harness's subscription you have used, as the harness last said.
        </Meta>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-1">
        {failure === undefined ? null : (
          <SectionFailure what="Usage" failure={failure} onRetry={reread} testId="usage-failure" />
        )}
        {rows === undefined ? (
          failure === undefined ? (
            <p className="py-3 text-sm text-muted-foreground" data-testid="usage-reading">
              Reading usage…
            </p>
          ) : null
        ) : rows === null || rows.length === 0 ? (
          <EmptyState title="No usage to show" testId="usage-empty">
            This Lab reads no harness's subscription usage.
          </EmptyState>
        ) : (
          rows.map((row) => <HarnessCard key={row.harness} row={row} />)
        )}
      </div>
    </div>
  );
}
