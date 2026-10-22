/**
 * One firing per scheduled time (FIX-2085 D2): which scheduled time a fire
 * counts against, and the one stored record per schedule that says the latest
 * time it fired.
 *
 * The dispatch endpoint is where every cron path meets (a host's own cron, the
 * Vercel GET shim, a polling tick, BullMQ's dispatch worker), so the claim is
 * made there, once, before the schedule's handler runs. A schedule index's own
 * claim only finds due rows; this one decides whether a time fires.
 *
 * The record lives in the host's resource-state store, in the user cell of the
 * principal the schedule runs as: beside a resource-collection schedule's own
 * row. It is claimed with the store's compare-and-set, so it holds across
 * processes on a store with compare-and-set across processes (SQLite,
 * Postgres). On the memory store, and on the filesystem store, whose lock is
 * per store instance, it holds per process only.
 */
import { CronExpressionParser } from "cron-parser";
import type { ResourceStateStore } from "@flow-state-dev/engine";
import type { ResolvedPrincipal } from "@flow-state-dev/core/types";
import { firedRecordKey } from "./firedRecords";

/** The latest scheduled time at or before `at`, or `null` when the cron has none. */
function latestAtOrBefore(cron: string, timezone: string, at: number): number | null {
  try {
    // `prev()` is strictly before its current date, so start a millisecond on.
    return CronExpressionParser.parse(cron, { tz: timezone, currentDate: new Date(at + 1) })
      .prev()
      .toDate()
      .getTime();
  } catch {
    return null;
  }
}

/** The first scheduled time strictly after `at`, or `null` when the cron has none. */
function firstAfter(cron: string, timezone: string, at: number): number | null {
  try {
    return CronExpressionParser.parse(cron, { tz: timezone, currentDate: new Date(at) })
      .next()
      .toDate()
      .getTime();
  } catch {
    return null;
  }
}

/**
 * How far a sender's clock may sit from ours and still land on the time it
 * meant: for a carried time, how far it may be from a scheduled time; for an
 * untimed fire, how early it may arrive for the time it is for.
 */
const SCHEDULED_TIME_TOLERANCE_MS = 5_000;

/** The scheduled time a fire counts against, or why it counts against none. */
export type ScheduledTimeResult =
  | {
      ok: true;
      at: number;
      /**
       * The time is more than one period behind the latest scheduled time
       * already due: a fixed time in a scheduler's body, or a host that
       * stalled. It is answered as a duplicate and runs nothing.
       */
      stale: boolean;
    }
  | { ok: false; error: "invalid_nominal_fire_time" | "not_a_scheduled_time" | "not_yet_due"; message: string };

/**
 * The scheduled time a fire counts against.
 *
 * - **A carried time** counts against the scheduled time within
 *   {@link SCHEDULED_TIME_TOLERANCE_MS} of it. A carried time near no
 *   scheduled time is refused, and so is one not yet due, so an early POST
 *   can't claim a time and swallow its real fire.
 * - **No carried time** counts against the latest scheduled time already due,
 *   never the next one; a fire up to the tolerance early counts against the
 *   time it is for, so a sender's clock a second ahead loses no run.
 *
 * A carried time more than one period behind the latest due time is `stale`.
 *
 * @param carried The dispatch body's `nominalFireTime`, as sent.
 * @param now The endpoint's clock, in ms since epoch.
 */
export function scheduledTimeOf(cron: string, timezone: string, carried: string | undefined, now: number): ScheduledTimeResult {
  if (carried === undefined) {
    const at = latestAtOrBefore(cron, timezone, now + SCHEDULED_TIME_TOLERANCE_MS);
    if (at === null) {
      return { ok: false, error: "not_a_scheduled_time", message: `schedule "${cron}" has no scheduled time already due` };
    }
    return { ok: true, at, stale: false };
  }
  const sent = Date.parse(carried);
  if (Number.isNaN(sent)) {
    return {
      ok: false,
      error: "invalid_nominal_fire_time",
      message: `nominalFireTime ${JSON.stringify(carried)} is not an ISO-8601 time`
    };
  }
  const candidates = [latestAtOrBefore(cron, timezone, sent), firstAfter(cron, timezone, sent)].filter(
    (time): time is number => time !== null && Math.abs(time - sent) <= SCHEDULED_TIME_TOLERANCE_MS
  );
  const at = candidates.sort((x, y) => Math.abs(x - sent) - Math.abs(y - sent))[0];
  if (at === undefined) {
    return {
      ok: false,
      error: "not_a_scheduled_time",
      message: `nominalFireTime ${carried} is not a scheduled time of "${cron}" in ${timezone}`
    };
  }
  if (at > now + SCHEDULED_TIME_TOLERANCE_MS) {
    return {
      ok: false,
      error: "not_yet_due",
      message: `nominalFireTime ${carried} is a scheduled time that hasn't arrived yet; it fires when it is due`
    };
  }
  return { ok: true, at, stale: isStale(cron, timezone, at, now) };
}

/** Whether `at` is more than one period behind the latest scheduled time already due at `now`. */
function isStale(cron: string, timezone: string, at: number, now: number): boolean {
  const latest = latestAtOrBefore(cron, timezone, now + SCHEDULED_TIME_TOLERANCE_MS);
  if (latest === null || at >= latest) return false;
  const before = latestAtOrBefore(cron, timezone, latest - 1);
  return before !== null && at < before;
}

/**
 * The one record a schedule keeps: the latest time it fired. A record written
 * before it was a floor also carries the cron and zone it fired under; those
 * are read past, never compared (BP-030).
 */
interface FiredRecord {
  lastFiredAt: number;
}

function readRecord(state: unknown): FiredRecord | undefined {
  const value = state as Partial<FiredRecord> | undefined;
  return typeof value?.lastFiredAt === "number" ? { lastFiredAt: value.lastFiredAt } : undefined;
}

/** Where a schedule's record is kept. */
export interface FiredRecordAddress {
  scopeId: string;
  key: string;
}

/**
 * The record's address: the user cell of the principal the schedule runs as,
 * under a key named for the flow and the schedule id.
 *
 * @param userStorageKey The cell derivation the endpoint hands the resolver
 *   (`ScheduleResolutionContext.userStorageKey`), so the record lands in the
 *   cell a resource-collection schedule's own row is read from, by one rule.
 */
export function firedRecordAddress(
  flowKind: string,
  scheduleId: string,
  principal: ResolvedPrincipal,
  userStorageKey: (userId: string, orgId: string) => string
): FiredRecordAddress {
  return { scopeId: userStorageKey(principal.userId, principal.orgId), key: firedRecordKey(flowKind, scheduleId) };
}

/** What a claim came to. */
export type ClaimOutcome =
  | {
      outcome: "claimed";
      /** Give the time back: only if nothing later claimed it since. */
      release(): Promise<void>;
    }
  | { outcome: "duplicate"; lastFiredAt: number };

/** How often a claim re-reads after losing a race, before it gives up. */
const CLAIM_ATTEMPTS = 8;

/**
 * Claim scheduled time `at` for a schedule: it fires only if the schedule's
 * record holds an earlier time, or none. The record is a floor whatever the
 * cron: after an edit, a job stalled under the old cron can't fire a time at
 * or before the last one. Compare-and-set, so of two hosts claiming one time,
 * one wins.
 *
 * @throws when the store keeps losing the race (a store that never settles).
 */
export async function claimScheduledTime(
  store: ResourceStateStore,
  address: FiredRecordAddress,
  claim: { at: number }
): Promise<ClaimOutcome> {
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    const current = await store.get("user", address.scopeId, address.key);
    const record = readRecord(current?.state);
    if (record !== undefined && record.lastFiredAt >= claim.at) return { outcome: "duplicate", lastFiredAt: record.lastFiredAt };
    const next: FiredRecord = { lastFiredAt: claim.at };
    const written = await store.set("user", address.scopeId, address.key, { ...next }, current?.version ?? 0);
    if (!written.ok) continue;
    const claimedVersion = written.version;
    const previous = current?.state;
    return {
      outcome: "claimed",
      async release() {
        // Version-checked against this claim: a later time claimed since
        // keeps its record, and this time stays spent.
        if (previous === undefined) {
          await store.delete("user", address.scopeId, address.key, claimedVersion);
        } else {
          await store.set("user", address.scopeId, address.key, { ...previous }, claimedVersion);
        }
      }
    };
  }
  throw new Error(`the scheduled time could not be claimed: the record kept changing (${address.key})`);
}
