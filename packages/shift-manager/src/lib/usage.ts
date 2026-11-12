// FIX-2145; FIX-2624.
/**
 * How much of each coding harness's subscription the user has used: the
 * usage flow's view (`harnessUsageFlow`), after a Re-check sent to the usage
 * collection, which its writer flow runs in the user's own write session.
 * And how many tokens each of the user's workers used over a period: the
 * roster flow's `workerUsage` view. Neither read finds or makes a session.
 *
 * Opening Usage asks for a fresh reading. The Lab asks a harness at most once
 * a minute, so a view that re-renders or re-reads costs nothing extra. What
 * comes back is drawn as returned: every age and every "rolled over" is the
 * Lab's, worked out by its clock, never this page's.
 */
import { useCallback, useEffect, useState } from "react";
import { ClientHttpError, type Client } from "@flow-state-dev/client";
import type { HarnessUsageLevel } from "@flow-state-dev/core/harness";
import { harnessUsageViewRef, recheckHarnessUsage } from "@flow-state-dev/harness-manager/browser";
import { workerUsageView } from "@flow-state-dev/workforce/browser";
import { useLab } from "./lab-data";
import { describeFailure, type Failure } from "./reads";

/** One window as the view returns it. */
export type UsageWindow = {
  id: string;
  label: string | null;
  minutes: number | null;
  /** `null` when the harness sent no percent: never shown as 0. */
  usedPercent: number | null;
  /** How close to its limit, when the harness said: `ok`, `warning`, `reached`. `null` from Codex. */
  level: HarnessUsageLevel | null;
  resetsAt: number | null;
  checkedAt: number;
  /** `read` when a look read it, `run` when a coding run reported it. */
  origin: string;
  ageMs: number;
  rolledOver: boolean;
};

/** One harness as the view returns it. */
export type HarnessUsage = {
  harness: string;
  status: "windows" | "api-key" | "signed-out" | "unavailable";
  reason: string | null;
  plan: string | null;
  windows: UsageWindow[];
  checkedAt: number | null;
  ageMs: number | null;
  refreshError: string | null;
};

/**
 * Whether `error` says this Lab serves no such usage: no flow declares it
 * (404), or the collection's writer flow isn't registered here (409).
 */
function servesNone(error: unknown): boolean {
  return error instanceof ClientHttpError && (error.status === 404 || error.status === 409);
}

/**
 * Re-check, then the usage rows. `null` when this Lab serves no usage. Re-check
 * asks each harness at most once a minute per user, so a re-read within the
 * minute answers the stored rows.
 */
export async function readHarnessUsageView(client: Client): Promise<HarnessUsage[] | null> {
  try {
    await recheckHarnessUsage(client);
    return toHarnessUsage((await client.view(harnessUsageViewRef(), {})).value);
  } catch (error) {
    if (servesNone(error)) return null;
    throw error;
  }
}

/** The view's rows, as sent. A row that isn't one is left out. */
export function toHarnessUsage(output: unknown): HarnessUsage[] {
  const rows = (output as { harnesses?: unknown } | null | undefined)?.harnesses;
  return Array.isArray(rows) ? rows.filter((row): row is HarnessUsage => typeof (row as HarnessUsage)?.harness === "string") : [];
}

/**
 * The usage rows, re-checked when the view opens and on each Lab read
 * (`readAt`). `rows` is `null` when this Lab serves no usage. A read
 * that fails keeps the last rows and reports `failure` beside them, so stale
 * rows never pass for fresh ones.
 */
export function useHarnessUsage(readAt: number): {
  rows: HarnessUsage[] | null | undefined;
  failure: Failure | undefined;
  reread: () => void;
} {
  const { client } = useLab();
  const [rows, setRows] = useState<HarnessUsage[] | null | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let closed = false;
    readHarnessUsageView(client)
      .then((read) => {
        if (closed) return;
        setRows(read);
        setFailure(undefined);
      })
      .catch((error: unknown) => {
        if (!closed) setFailure(describeFailure(error));
      });
    return () => {
      closed = true;
    };
  }, [client, readAt, reads]);
  const reread = useCallback(() => setReads((n) => n + 1), []);
  return { rows, failure, reread };
}

/** One source of a worker's spend, as the query returns it: a model, or a harness billed one way. */
export type WorkerSourceUsage = {
  source: string;
  kind: "model" | "harness";
  billing: "api-key" | "subscription" | null;
  inputTokens: number;
  outputTokens: number;
  /** A cost the harness reported on an API key. `null`: none was, never shown as $0. */
  costUsd: number | null;
  runs: number;
  /** Runs that reported no tokens. */
  unreported: number;
};

/** One worker as the query returns it. */
export type WorkerUsage = {
  worker: string;
  /** No longer on the user's roster. */
  gone: boolean;
  tokens: { input: number; output: number };
  costUsd: number | null;
  bySource: WorkerSourceUsage[];
};

/** The periods the view offers, in UTC days ending today. */
export const USAGE_PERIODS = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
] as const;

/** The query's worker entries, as sent. A row that isn't one is left out. */
export function toWorkerUsage(output: unknown): WorkerUsage[] {
  const rows = (output as { workers?: unknown } | null | undefined)?.workers;
  return Array.isArray(rows) ? rows.filter((row): row is WorkerUsage => typeof (row as WorkerUsage)?.worker === "string") : [];
}

/** Each worker's usage over the last `days` UTC days. `null` when this Lab keeps no roster flow. */
export async function readWorkerUsageView(client: Client, days: number): Promise<WorkerUsage[] | null> {
  try {
    return toWorkerUsage((await client.view(workerUsageView, { days })).value);
  } catch (error) {
    if (servesNone(error)) return null;
    throw error;
  }
}

/**
 * Each worker's usage over the last `days` UTC days, read when the view opens,
 * on each Lab read (`readAt`), and when the period changes. `rows` is `null`
 * when this Lab keeps no roster flow. A read that fails keeps the last
 * rows for the same period and reports `failure` beside them; rows read for
 * another period are never returned, so one period's totals never stand
 * under another's tab.
 */
export function useWorkerUsage(
  readAt: number,
  days: number,
): {
  rows: WorkerUsage[] | null | undefined;
  failure: Failure | undefined;
  reread: () => void;
} {
  const { client } = useLab();
  const [read, setRead] = useState<{ days: number; rows?: WorkerUsage[] | null; failure?: Failure } | undefined>(undefined);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let closed = false;
    readWorkerUsageView(client, days)
      .then((rows) => {
        if (!closed) setRead({ days, rows });
      })
      .catch((error: unknown) => {
        if (!closed) setRead((last) => ({ days, rows: last?.days === days ? last.rows : undefined, failure: describeFailure(error) }));
      });
    return () => {
      closed = true;
    };
  }, [client, readAt, reads, days]);
  const reread = useCallback(() => setReads((n) => n + 1), []);
  const current = read?.days === days ? read : undefined;
  return { rows: current?.rows, failure: current?.failure, reread };
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
