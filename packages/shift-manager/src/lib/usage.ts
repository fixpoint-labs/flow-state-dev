/**
 * How much of each coding harness's subscription the user has used: the Lab's
 * one `harnessUsage` query, read on the flow that answers it.
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

/** The Lab flow that answers the query, read once per connection. `null`: this Lab has none. */
const usageFlows = new WeakMap<Client, Promise<string | null>>();

function usageFlowOf(client: Client): Promise<string | null> {
  let found = usageFlows.get(client);
  if (found === undefined) {
    found = client
      .flows()
      .then((flows) => flows.find((flow) => flow.actions.includes(HARNESS_USAGE_ACTION))?.id ?? null);
    found.catch(() => usageFlows.delete(client));
    usageFlows.set(client, found);
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
export async function runUsageQuery(client: Client, flow: string): Promise<unknown> {
  const reader = readerSessionId(client.userId, flow);
  try {
    return (await runAction(client, flow, reader, HARNESS_USAGE_ACTION, { refresh: true })).output;
  } catch (error) {
    if (!(error instanceof ActionRefused)) throw error;
    const listed = await client.sessions.list({ userId: client.userId });
    if (listed.some((session) => session.id === reader)) throw error;
    const own = listed.find(
      (session) => session.parentSessionId == null && session.flowKind === flow && session.id.startsWith(`${USAGE_SESSION_PREFIX}-`),
    )?.id;
    return (await runAction(client, flow, own ?? newSessionId(USAGE_SESSION_PREFIX), HARNESS_USAGE_ACTION, { refresh: true })).output;
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
