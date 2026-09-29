/**
 * One inbox-watch scenario, shared by every authoring variant.
 *
 * Not a product noun. Three inbound arrivals, three different doors:
 *   - cron tick → scheduled dispatch (Layer 1)
 *   - GitHub `issues` delivery → webhook binding (Layer 1)
 *   - a post on a Workforce channel → seat notify (Layer 2; does not compile)
 *
 * The cron string is display/validation only. The host's scheduler POSTs
 * `POST /api/flows/:kind/schedules/sweep-open/dispatch`. The framework does
 * not run the clock.
 */

export const SWEEP_SCHEDULE_ID = "sweep-open";
export const SWEEP_CRON = "*/15 * * * *";
export const SWEEP_TIMEZONE = "UTC";

export const GITHUB_PROVIDER = "github";
/** Value of `X-GitHub-Event`. The `opened` sub-action is a `when` predicate. */
export const GITHUB_ISSUES_EVENT = "issues";

export const INBOX_WAKE_TABLE = {
  schedules: [
    {
      id: SWEEP_SCHEDULE_ID,
      cron: SWEEP_CRON,
      fires: "Host scheduler POSTs the dispatch contract every 15 minutes (UTC).",
      runs: "sweep-open-tickets — records that a sweep ran. New session each tick.",
    },
  ],
  webhooks: [
    {
      provider: GITHUB_PROVIDER,
      event: GITHUB_ISSUES_EVENT,
      fires: "Verified GitHub `issues` delivery whose payload.action is `opened`.",
      runs: "record-inbound-issue — same session for repo#number.",
    },
  ],
  leftover: [
    {
      id: "desk-poke",
      fires: "A post on channel `support.desk` (Workforce notify).",
      runs: "Layer 2 `onChannelPost` / `wakeMemberSeats`. No L1 binding.",
    },
  ],
} as const;
