/**
 * Claude Code's subscription usage, in the neutral shape core declares
 * (`HarnessUsageWindow`, `HarnessUsageReading`).
 *
 * Two sources, both sanctioned:
 *
 * - **A run's `rate_limit_event`.** Claude Code sends one when its limits
 *   change, at least once per run on a subscription. It names the window that
 *   binds (`rateLimitType`), its reset (`resetsAt`, epoch seconds) and a status.
 *   It carries a percent (`utilization`, a fraction) only near a limit.
 *   {@link usageWindowOf} maps one to a window; `claudeCodeAgent` hands it to
 *   its `onUsage` hook.
 * - **The account, on demand.** {@link readClaudeUsage} asks
 *   `probeClaudeAccount` who is signed in. It reports the account and plan
 *   and no windows: no allowed source gives a percent without a run.
 *
 * Nothing here reads a credentials file, calls a usage endpoint, or uses the
 * SDK's experimental usage call.
 */
import type { HarnessUsageLevel, HarnessUsageReading, HarnessUsageWindow } from "@flow-state-dev/core/types";
import { probeClaudeAccount, type ClaudeAccountProbe, type ProbeClaudeAccountOptions } from "./account-probe";

/** The usage record's name for Claude Code. */
export const CLAUDE_CODE_HARNESS = "claude-code";

/** Window lengths for the ids Claude Code sends. `overage` and anything new have none, and are labelled by id. */
const WINDOW_MINUTES: Readonly<Record<string, number>> = {
  five_hour: 300,
  seven_day: 10_080,
  seven_day_opus: 10_080,
  seven_day_sonnet: 10_080,
  seven_day_overage_included: 10_080,
};

const LEVELS: Readonly<Record<string, HarnessUsageLevel>> = {
  allowed: "ok",
  allowed_warning: "warning",
  rejected: "reached",
};

/**
 * One `rate_limit_event`'s `rate_limit_info` as a usage window, or `null`
 * when it names no window (an API-key run) or a status this package doesn't
 * know.
 *
 * `utilization` is a fraction and is multiplied by 100. One above 1 is not a
 * fraction, so it is dropped rather than shown as thousands of percent.
 */
export function usageWindowOf(info: unknown): HarnessUsageWindow | null {
  if (typeof info !== "object" || info === null) return null;
  const { rateLimitType, status, utilization, resetsAt } = info as Record<string, unknown>;
  if (typeof rateLimitType !== "string" || rateLimitType === "") return null;
  const level = typeof status === "string" ? LEVELS[status] : undefined;
  if (level === undefined) return null;
  const fraction = typeof utilization === "number" && utilization >= 0 && utilization <= 1;
  // To one decimal place, so a float's tail (0.29 * 100 = 28.999…) never shows.
  const usedPercent = fraction ? Math.round(utilization * 1000) / 10 : null;
  return {
    id: rateLimitType,
    label: null,
    minutes: WINDOW_MINUTES[rateLimitType] ?? null,
    usedPercent,
    level,
    resetsAt: typeof resetsAt === "number" && Number.isFinite(resetsAt) ? resetsAt * 1000 : null,
  };
}

/** Options for {@link readClaudeUsage}: the probe's. */
export type ReadClaudeUsageOptions = ProbeClaudeAccountOptions & {
  /** How the account is asked for. A seam for tests; default {@link probeClaudeAccount}. */
  probe?: (options: ProbeClaudeAccountOptions) => Promise<ClaudeAccountProbe>;
};

/**
 * Read who Claude Code is signed in as, for the usage record: a
 * `HarnessUsageReader` once its options are bound.
 *
 * An API key is `api-key`. A sign-in or an OAuth token is `windows`, with the
 * email as the account id when there is one (the store keeps a hash) and the
 * plan, and **no windows**: the windows come from runs. Nobody signed in is
 * `signed-out`. An SDK that won't load, or a probe that got no answer, is
 * `unavailable`, which leaves a stored reading in place. Never throws.
 */
export async function readClaudeUsage(options: ReadClaudeUsageOptions): Promise<HarnessUsageReading> {
  const { probe = probeClaudeAccount, ...probeOptions } = options;
  let found: ClaudeAccountProbe;
  try {
    found = await probe(probeOptions);
  } catch {
    return { status: "unavailable", reason: "Claude Code's account could not be read" };
  }
  if (found.status === "sdk-missing") return { status: "unavailable", reason: "Claude Code's Agent SDK is not installed" };
  // A probe that got no answer knows nothing: `unavailable` keeps the stored reading.
  if (found.status === "none" && found.unanswered) return { status: "unavailable", reason: found.reason };
  if (found.status === "none") return { status: "signed-out", reason: "Claude Code is not signed in: not available automatically" };
  if (found.apiKeySource !== undefined) return { status: "api-key", reason: "Claude Code uses an API key: no subscription limit" };
  return { status: "windows", accountId: found.email ?? null, plan: found.subscriptionType ?? null, windows: [] };
}
