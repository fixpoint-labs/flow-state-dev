/**
 * One night-watch desk, shared by both on-disk layouts.
 *
 * Not a product noun. Three arrivals, three doors:
 *   - cron tick → scheduled dispatch (Layer 1)
 *   - GitHub `issues` delivery → webhook binding (Layer 1)
 *   - a post on a Workforce channel → seat notify (Layer 2 leftover)
 *
 * The cron string is display/validation. The host's scheduler POSTs
 * `POST /api/flows/:kind/schedules/sweep-open/dispatch`. FSD does not tick.
 */

export const SWEEP_SCHEDULE_ID = "sweep-open";
export const SWEEP_CRON = "*/15 * * * *";
export const SWEEP_TIMEZONE = "UTC";

export const GITHUB_PROVIDER = "github";
/** Value of `X-GitHub-Event`. The `opened` sub-action is a `when` predicate. */
export const GITHUB_ISSUES_EVENT = "issues";

/** A. Central ingress owns this kind. Host POSTs here. */
export const CENTRAL_INGRESS_KIND = "night-watch";
export const CENTRAL_SWEEP_KIND = "night-sweep";
export const CENTRAL_INTAKE_KIND = "night-intake";
export const CENTRAL_TRIAGE_KIND = "night-triage";

/** B. Each flow owns its own kind. Host POSTs per flow. */
export const DESK_SWEEP_KIND = "inbox-sweep";
export const DESK_INTAKE_KIND = "inbox-intake";
export const DESK_TRIAGE_KIND = "inbox-triage";
