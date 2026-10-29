/**
 * Usage (FIX-2141): how much of each coding harness's subscription the user
 * has used, window by window, from the Lab's one usage query.
 *
 * A number is never shown without where it came from and how old it is. A
 * window whose reset has passed shows when it reset instead of its old
 * percent, and a harness with no number (an API key, nobody signed in, a read
 * that failed) says why, with no percent at all. A window the harness sent no
 * percent for (Claude Code below its warning line, or at its limit) says how
 * close it is instead, and a window a run reported says so, with its own age.
 *
 * Under the windows (FIX-2145): how many tokens each of the user's workers
 * used, today or over 7 or 30 UTC days, by model and harness. It is usage,
 * not what is left: a cost shows only where a harness reported one on an API
 * key, and every other source says its cost was not reported.
 */
import { useState } from "react";
import { EmptyState, Meta, ScreenTitle, SectionFailure } from "../components/ui";
import type { LoadedSnapshot } from "../lib/derive";
import { cn } from "../lib/utils";
import {
  ageLabel,
  billingLabel,
  costLabel,
  harnessName,
  levelLabel,
  noTokensReported,
  percentLabel,
  reportedTokensLabel,
  resetLabel,
  sourceName,
  USAGE_PERIODS,
  useHarnessUsage,
  useWorkerUsage,
  windowName,
  type HarnessUsage,
  type UsageWindow,
  type WorkerUsage,
} from "../lib/usage";

function WindowLine({ window, harness }: { window: UsageWindow; harness: string }) {
  return (
    <li
      className="grid grid-cols-[minmax(9rem,max-content)_1fr] items-baseline gap-x-4 border-b border-foreground/10 py-2"
      data-testid="usage-window"
      data-window-id={window.id}
      data-rolled-over={window.rolledOver}
      data-level={window.level ?? undefined}
      data-origin={window.origin}
    >
      <span className="text-sm" data-testid="usage-window-name">
        {windowName(window)}
      </span>
      {window.rolledOver ? (
        <Meta className="text-muted-foreground" testId="usage-rolled-over">
          {window.resetsAt === null ? "reset" : `reset at ${resetLabel(window.resetsAt)}`}, not checked since
        </Meta>
      ) : (
        <span className="flex flex-wrap items-baseline gap-x-3">
          {window.level === "reached" || window.usedPercent === null ? (
            <Meta role="control" testId="usage-level">
              {levelLabel(window.level, harness)}
            </Meta>
          ) : (
            <Meta role="control" testId="usage-percent">
              {percentLabel(window.usedPercent)}
            </Meta>
          )}
          {window.resetsAt === null ? null : (
            <Meta className="text-muted-foreground" testId="usage-reset">
              resets at {resetLabel(window.resetsAt)}
            </Meta>
          )}
          {window.origin === "run" ? (
            <Meta className="text-muted-foreground" testId="usage-window-age">
              from a run, {ageLabel(window.ageMs)}
            </Meta>
          ) : null}
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
          {row.ageMs !== null
            ? `from ${name}, checked ${ageLabel(row.ageMs)}`
            : row.windows.length > 0
              ? `from ${name}'s runs`
              : "not checked yet"}
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
              <WindowLine key={window.id} window={window} harness={row.harness} />
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

function WorkerCard({ row }: { row: WorkerUsage }) {
  return (
    <section className="border-b border-foreground/20 py-3" data-testid="worker-usage-row" data-worker={row.worker} data-gone={row.gone}>
      <header className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="text-sm font-semibold">{row.worker}</h3>
        {row.gone ? (
          <Meta className="text-muted-foreground" testId="worker-usage-gone">
            no longer on your roster
          </Meta>
        ) : null}
        <Meta role="control" className="ml-auto" testId="worker-usage-tokens">
          {reportedTokensLabel(row.tokens.input + row.tokens.output, row.bySource)}
        </Meta>
      </header>
      <ul className="mt-1">
        {row.bySource.map((source) => {
          const billing = billingLabel(source.billing);
          return (
            <li
              key={`${source.kind}:${source.source}:${source.billing ?? ""}`}
              className="grid grid-cols-[minmax(9rem,max-content)_1fr] items-baseline gap-x-4 border-b border-foreground/10 py-2"
              data-testid="worker-usage-source"
              data-source={source.source}
              data-kind={source.kind}
              data-billing={source.billing ?? undefined}
            >
              <span className="text-sm" data-testid="worker-usage-source-name">
                {sourceName(source)}
                {billing === null ? null : <span className="text-muted-foreground"> · {billing}</span>}
              </span>
              <span className="flex flex-wrap items-baseline gap-x-3">
                <Meta role="control" testId="worker-usage-source-tokens">
                  {reportedTokensLabel(source.inputTokens + source.outputTokens, [source])}
                </Meta>
                {noTokensReported(source) ? null : (
                  <Meta className="text-muted-foreground" testId="worker-usage-source-split">
                    {source.inputTokens.toLocaleString("en-US")} in, {source.outputTokens.toLocaleString("en-US")} out
                  </Meta>
                )}
                <Meta className="text-muted-foreground" testId="worker-usage-cost">
                  {costLabel(source)}
                </Meta>
                {source.unreported === 0 ? null : (
                  <Meta className="text-muted-foreground" testId="worker-usage-unreported">
                    {source.unreported} of {source.runs} {source.runs === 1 ? "run" : "runs"} reported no tokens
                  </Meta>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function WorkerUsageSection({ readAt }: { readAt: number }) {
  const [days, setDays] = useState<number>(7);
  const { rows, failure, reread } = useWorkerUsage(readAt, days);
  // A Lab that answers no per-worker query shows nothing here.
  if (rows === null) return null;
  return (
    <section className="mt-5" data-testid="worker-usage" data-days={days}>
      <header className="flex flex-wrap items-center gap-3 border-b border-foreground/20 pb-2">
        <h2 className="text-sm font-semibold">Usage by worker</h2>
        <div role="tablist" aria-label="Period" className="ml-auto flex border border-foreground font-mono text-[11.5px] font-medium" data-testid="worker-usage-period">
          {USAGE_PERIODS.map((period, i) => (
            <button
              key={period.days}
              type="button"
              role="tab"
              aria-selected={period.days === days}
              data-days={period.days}
              onClick={() => setDays(period.days)}
              className={cn("px-3 py-[5px]", i > 0 && "border-l border-foreground", period.days === days && "bg-foreground text-background")}
            >
              {period.label}
            </button>
          ))}
        </div>
      </header>
      <Meta className="mt-1 block text-muted-foreground" testId="worker-usage-note">
        Tokens each worker used for you, by model and coding harness. Days are UTC.
      </Meta>
      {failure === undefined ? null : (
        <SectionFailure what="Usage by worker" failure={failure} onRetry={reread} testId="worker-usage-failure" />
      )}
      {rows === undefined ? (
        failure === undefined ? (
          <p className="py-3 text-sm text-muted-foreground" data-testid="worker-usage-reading">
            Reading usage by worker…
          </p>
        ) : null
      ) : rows.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground" data-testid="worker-usage-empty">
          No worker used any tokens in this period.
        </p>
      ) : (
        rows.map((row) => <WorkerCard key={row.worker} row={row} />)
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
        <WorkerUsageSection readAt={snapshot.readAt} />
      </div>
    </div>
  );
}
