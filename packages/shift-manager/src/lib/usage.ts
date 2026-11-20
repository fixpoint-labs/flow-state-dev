// FIX-2145; FIX-2624.
/**
 * How much of each coding harness's subscription the user has used: the
 * usage flow's view (`harnessUsageFlow`), after a Re-check sent to the usage
 * collection, which its writer flow runs in the user's own write session.
 * And how many tokens each of the user's workers used over a period: the
 * roster flow's `workerUsage` view. Neither read finds or makes a session.
 *
 * Opening Usage asks for a fresh reading. The Lab asks a harness at most once
 * a minute, so a view that re-renders or re-reads costs nothing extra. Both
 * views are kept current by their own notices: a run reporting usage shows
 * when the view hears it. What
 * comes back is drawn as returned: every age and every "rolled over" is the
 * Lab's, worked out by its clock, never this page's.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ViewValueOf } from "@flow-state-dev/client";
import { useView } from "@flow-state-dev/react";
import { harnessUsageViewRef, recheckHarnessUsage } from "@flow-state-dev/harness-manager/browser";
import { workerUsageView } from "@flow-state-dev/workforce/browser";
import { useLab } from "./lab-data";
import { describeFailure, type Failure } from "./failure";

/** The harness usage view, read with no session. */
const HARNESS_USAGE = harnessUsageViewRef();

/** One harness as the usage view returns it. */
export type HarnessUsage = ViewValueOf<typeof HARNESS_USAGE>["harnesses"][number];

/** One window as the usage view returns it. */
export type UsageWindow = HarnessUsage["windows"][number];

/** One worker as the worker usage view returns it. */
export type WorkerUsage = ViewValueOf<typeof workerUsageView>["workers"][number];

/** One source of a worker's spend, as the worker usage view returns it: a model, or a harness billed one way. */
export type WorkerSourceUsage = WorkerUsage["bySource"][number];

/**
 * Whether a failure says this Lab serves no such usage: no flow declares it or
 * the view (404), or, on Re-check, a collection whose writer flow isn't
 * registered here (409 `runby_flow_missing`). Every other refusal is a failure
 * the screen shows.
 */
function servesNone(failure: Failure, onRecheck: boolean): boolean {
  if (failure.httpStatus === 404) return true;
  return onRecheck && failure.httpStatus === 409 && failure.message === "runby_flow_missing";
}

/**
 * The usage rows, from the usage view, kept current by it, after a Re-check
 * when the screen opens and on its Retry. `rows` is `null` when this Lab
 * serves no usage. Re-check asks each harness at most once a minute per user,
 * so the view's answer within the minute is the stored rows. A Re-check that
 * fails (a 5xx, a refused caller, the network) never hides them: they come
 * with why as each row's `refreshError`. A 409 other than a missing writer
 * flow is the Lab's set-up, not a missed attempt, and is the screen's failure.
 * A read that fails keeps the last rows and reports `failure` beside them, so
 * stale rows never pass for fresh ones.
 */
export function useHarnessUsage(): {
  rows: HarnessUsage[] | null | undefined;
  failure: Failure | undefined;
  reread: () => void;
} {
  const { client } = useLab();
  const { value, failure, refresh } = useView(HARNESS_USAGE, {}, { client });
  // What the last Re-check came to: none sent yet, gone through, serves none, or why it failed.
  const [recheck, setRecheck] = useState<{ state: "sent" | "done" | "none" } | { state: "failed"; failure: Failure }>({ state: "sent" });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let closed = false;
    recheckHarnessUsage(client).then(
      () => !closed && setRecheck({ state: "done" }),
      (error: unknown) => {
        if (closed) return;
        const why = describeFailure(error);
        setRecheck(servesNone(why, true) ? { state: "none" } : { state: "failed", failure: why });
      },
    );
    return () => {
      closed = true;
    };
  }, [client, tries]);
  const reread = useCallback(() => {
    setTries((n) => n + 1);
    refresh();
  }, [refresh]);
  const conflict = recheck.state === "failed" && recheck.failure.httpStatus === 409 ? recheck.failure : undefined;
  const refreshError = recheck.state === "failed" && conflict === undefined ? recheck.failure.message : null;
  const rows = useMemo(
    () => (value === undefined ? undefined : refreshError === null ? value.harnesses : value.harnesses.map((usage) => ({ ...usage, refreshError }))),
    [value, refreshError],
  );
  if (recheck.state === "none" || (rows === undefined && failure !== undefined && servesNone(failure, false))) return { rows: null, failure: undefined, reread };
  return { rows, failure: conflict ?? failure, reread };
}

/** The periods the view offers, in UTC days ending today. */
export const USAGE_PERIODS = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
] as const;

/**
 * Each worker's usage over the last `days` UTC days, from the worker usage
 * view, kept current by it and read again when the period changes. `rows` is
 * `null` when this Lab keeps no roster flow (404). A read that fails keeps
 * the last rows for the same period and reports `failure` beside them; rows
 * read for another period are never returned, so one period's totals never
 * stand under another's tab.
 */
export function useWorkerUsage(days: number): {
  rows: WorkerUsage[] | null | undefined;
  failure: Failure | undefined;
  reread: () => void;
} {
  const { client } = useLab();
  const { value, failure, refresh } = useView(workerUsageView, { days }, { client });
  if (value === undefined && failure !== undefined && servesNone(failure, false)) return { rows: null, failure: undefined, reread: refresh };
  return { rows: value?.workers, failure, reread: refresh };
}

/** A token count for a user: `840 tokens`, `12.5 K tokens`, `1.2 M tokens`. */
export function tokensLabel(tokens: number): string {
  const short = (n: number) => n.toFixed(1).replace(/\.0$/, "");
  if (tokens >= 1_000_000) return `${short(tokens / 1_000_000)} M tokens`;
  if (tokens >= 10_000) return `${short(tokens / 1_000)} K tokens`;
  return `${tokens.toLocaleString("en-US")} tokens`;
}

/** True when no run of `source` reported tokens: its zero is unknown, not measured. */
export function noTokensReported(source: Pick<WorkerSourceUsage, "runs" | "unreported">): boolean {
  return source.runs > 0 && source.unreported === source.runs;
}

/**
 * A source's or worker's token figure in words: "tokens not reported" when
 * none of `sources` reported any, so an unknown count never reads as 0.
 */
export function reportedTokensLabel(tokens: number, sources: ReadonlyArray<Pick<WorkerSourceUsage, "runs" | "unreported">>): string {
  return sources.length > 0 && sources.every(noTokensReported) ? "tokens not reported" : tokensLabel(tokens);
}

/** A source's name: a harness by name (`Claude Code`), a model by its id. */
export function sourceName(source: Pick<WorkerSourceUsage, "source" | "kind">): string {
  return source.kind === "harness" ? harnessName(source.source) : source.source;
}

/**
 * What a source cost, in words: the dollar figure and who reported it when a
 * harness reported one on an API key, otherwise "cost not reported". Never a
 * figure nobody reported.
 */
export function costLabel(source: Pick<WorkerSourceUsage, "source" | "kind" | "costUsd">): string {
  if (source.costUsd === null) return "cost not reported";
  return `$${source.costUsd.toFixed(2)}, reported by ${sourceName(source)}`;
}

/** How a harness run was paid for, in words, or `null` for a model or a harness that didn't say. */
export function billingLabel(billing: WorkerSourceUsage["billing"]): string | null {
  if (billing === "api-key") return "API key";
  if (billing === "subscription") return "subscription";
  return null;
}

/** A window's percent as the vendor gave it, fractions kept: `7.5% used`. */
export function percentLabel(usedPercent: number): string {
  return `${usedPercent}% used`;
}

/**
 * What a window with no percent says instead, from its level: "limit
 * reached", "near its limit", or "under Claude Code's warning line". Never a
 * number the harness didn't send.
 */
export function levelLabel(level: UsageWindow["level"], harness: string): string {
  if (level === "reached") return "limit reached";
  if (level === "warning") return "near its limit";
  if (level === "ok") return `under ${harnessName(harness)}'s warning line`;
  return "no percent reported";
}

/** A harness's name as the user reads it: `codex` is Codex, `claude-code` is Claude Code. */
export function harnessName(harness: string): string {
  return harness
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * A window's name: its length where the vendor gave one ("5-hour", "Weekly"),
 * after its limit's name when it has one, and otherwise its limit and slot
 * ("codex · primary").
 */
export function windowName(window: Pick<UsageWindow, "id" | "label" | "minutes">): string {
  const [limit, slot] = window.id.includes(":") ? window.id.split(":", 2) : [window.id, null];
  if (window.minutes === null) return [window.label ?? limit, slot].filter(Boolean).join(" · ");
  const length =
    window.minutes === 10_080
      ? "Weekly"
      : window.minutes === 1_440
        ? "Daily"
        : window.minutes % 60 === 0
          ? `${window.minutes / 60}-hour`
          : `${window.minutes}-minute`;
  return window.label === null ? length : `${window.label} · ${length}`;
}

/** How old a reading is, in words: "a few seconds ago", "3 min ago", "2 h ago". */
export function ageLabel(ageMs: number): string {
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return "a few seconds ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** A reset time, in the page's time zone: "14:00", with the day when it isn't today. */
export function resetLabel(at: number, now: number = Date.now()): string {
  const when = new Date(at);
  const time = when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (when.toDateString() === new Date(now).toDateString()) return time;
  return `${when.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}
