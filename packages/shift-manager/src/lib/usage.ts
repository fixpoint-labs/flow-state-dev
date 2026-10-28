/**
 * How much of each coding harness's subscription the user has used: the Lab's
 * one `harnessUsage` query, read on the flow that answers it. And how many
 * tokens each of the user's workers used over a period: the `workerUsage`
 * query, on the same flow (FIX-2145).
 *
 * Opening Usage asks for a fresh reading (`refresh: true`). The Lab asks a
 * harness at most once a minute, so a view that re-renders or re-reads costs
 * nothing extra. What comes back is drawn as returned: every age and every
 * "rolled over" is the Lab's, worked out by its clock, never this page's.
 */
import { useCallback, useEffect, useState } from "react";
import type { HarnessUsageLevel } from "@flow-state-dev/core/types";
import { ActionRefused, runAction } from "./action";
import { newSessionId } from "./ids";
import { useLab } from "./lab-data";
import { describeFailure, readerSessionId, type Failure } from "./reads";
import type { Client } from "@flow-state-dev/client";

/** The query's name, on whichever of the Lab's flows answers it. */
const HARNESS_USAGE_ACTION = "harnessUsage";

/** The per-worker query's name, answered by the same flow. */
const WORKER_USAGE_ACTION = "workerUsage";

/** One window as the query returns it. */
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

/** One harness as the query returns it. */
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

/** The Lab flow that answers each query, read once per connection and query. `null`: this Lab has none. */
const usageFlows = new WeakMap<Client, Map<string, Promise<string | null>>>();

function usageFlowOf(client: Client, action: string = HARNESS_USAGE_ACTION): Promise<string | null> {
  let byAction = usageFlows.get(client);
  if (byAction === undefined) {
    byAction = new Map();
    usageFlows.set(client, byAction);
  }
  let found = byAction.get(action);
  if (found === undefined) {
    found = client.flows().then((flows) => flows.find((flow) => flow.actions.includes(action))?.id ?? null);
    found.catch(() => byAction.delete(action));
    byAction.set(action, found);
  }
  return found;
}

/** The prefix of the usage session opened when the user's one reader id is another organization's. */
const USAGE_SESSION_PREFIX = "usage-own";

/**
 * Run the query on the user's reading session on `flow`. Session ids are not
 * scoped by organization, so when that one id is held in another of the
 * user's organizations (refused here, and not in this organization's
 * listing), it runs on this organization's own usage session instead, opened
 * on first use and found again by its prefix.
 */
export async function runUsageQuery(
  client: Client,
  flow: string,
  action: string = HARNESS_USAGE_ACTION,
  input: unknown = { refresh: true },
): Promise<unknown> {
  const reader = readerSessionId(client.userId, flow);
  try {
    return (await runAction(client, flow, reader, action, input)).output;
  } catch (error) {
    if (!(error instanceof ActionRefused)) throw error;
    const listed = await client.sessions.list({ userId: client.userId });
    if (listed.some((session) => session.id === reader)) throw error;
    const own = listed.find(
      (session) => session.parentSessionId == null && session.flowKind === flow && session.id.startsWith(`${USAGE_SESSION_PREFIX}-`),
    )?.id;
    return (await runAction(client, flow, own ?? newSessionId(USAGE_SESSION_PREFIX), action, input)).output;
  }
}

/** The query's rows, as sent. A row that isn't one is left out. */
export function toHarnessUsage(output: unknown): HarnessUsage[] {
  const rows = (output as { harnesses?: unknown } | null | undefined)?.harnesses;
  return Array.isArray(rows) ? rows.filter((row): row is HarnessUsage => typeof (row as HarnessUsage)?.harness === "string") : [];
}

/**
 * The usage rows, refreshed when the view opens and on each Lab read
 * (`readAt`). `rows` is `null` when this Lab answers no usage query. A read
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
    usageFlowOf(client)
      .then(async (flow) => {
        if (flow === null) return null;
        return toHarnessUsage(await runUsageQuery(client, flow));
      })
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

/** The query's worker rows, as sent. A row that isn't one is left out. */
export function toWorkerUsage(output: unknown): WorkerUsage[] {
  const rows = (output as { workers?: unknown } | null | undefined)?.workers;
  return Array.isArray(rows) ? rows.filter((row): row is WorkerUsage => typeof (row as WorkerUsage)?.worker === "string") : [];
}

/**
 * Each worker's usage over the last `days` UTC days, read when the view opens,
 * on each Lab read (`readAt`), and when the period changes. `rows` is `null`
 * when this Lab answers no per-worker query. A read that fails keeps the last
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
    usageFlowOf(client, WORKER_USAGE_ACTION)
      .then(async (flow) => {
        if (flow === null) return null;
        return toWorkerUsage(await runUsageQuery(client, flow, WORKER_USAGE_ACTION, { days }));
      })
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
