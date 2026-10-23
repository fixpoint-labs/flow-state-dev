/**
 * `harness-usage/**` — how much of each harness's subscription a person has
 * used, as its vendor last said, and the one query everything reads it through.
 *
 * A run fails with no warning when a subscription window runs out. This
 * collection holds the last reading of every window, per person and per
 * harness, and {@link harnessUsageAction} is the one way to read it: a Usage
 * screen and a worker call the same query and get the same rows, each with
 * its age.
 *
 * ## One writer, one reader
 *
 * {@link recordHarnessUsage} is the only writer and {@link readHarnessUsage}
 * the only reader. Nothing else opens the collection, and it is not readable
 * from a client on its own, so a row can never be shown without its age.
 *
 * - **A write never goes backwards.** A reading older than the stored one is
 *   refused whole: its status, account and plan as much as its windows. A
 *   slow answer can't replace a fresher one.
 * - **A failed read keeps the last good one.** An `unavailable` reading over a
 *   stored reading leaves it and records why as `refreshError`. It replaces
 *   only a row that never held one.
 * - **One current record per harness.** The key is the harness alone, and a
 *   reading replaces the whole record, account included, so a sign-in change
 *   leaves no old account's percents behind. The account is kept only as
 *   `hashKeySegment(accountId)`; no email is stored.
 * - **Latest only.** No history: a window's next reading overwrites it.
 *
 * ## Read when someone looks
 *
 * A registered reader runs only when a caller asks for `refresh`, at most once
 * a minute per person and harness, counted from the last *attempt*, so a
 * failing reader costs one try a minute rather than one per render. Concurrent
 * refreshes share one call. A read without `refresh` starts nothing.
 *
 * `rolledOver` and `ageMs` are worked out when the query reads, by the
 * server's clock, so a browser whose clock is off draws what the query said.
 *
 * ## A named limit: `user` scope is the bare user id
 *
 * As on `inbox/**`: where one user id is reachable from two tenants, both see
 * this row. It is filled only by a reader on the person's own machine and
 * holds no email, so the exposure is that person's plan and percents.
 */
import { defineCapability, defineResourceCollection, handler } from "@flow-state-dev/core";
import { updateStateWith } from "@flow-state-dev/core/helpers";
import type { BlockContext, HarnessUsageReader, HarnessUsageReading } from "@flow-state-dev/core/types";
import { harnessUsageWindowSchema } from "@flow-state-dev/core";
import { z } from "zod";
import { assertSafeSegment, hashKeySegment } from "./workspace";

/** Accessor key and storage prefix for the usage record. */
export const HARNESS_USAGE = "harness-usage" as const;

/** How often a registered reader may be tried, per person and harness: once a minute. */
export const USAGE_REFRESH_EVERY_MS = 60_000;

/** How long the query waits for a reader before reading `unavailable`. */
export const USAGE_READ_TIMEOUT_MS = 10_000;

/**
 * One stored window: the vendor's reading, when it was made, and how it
 * arrived. `origin` is `"read"` for an on-demand read; a run-time writer adds
 * its own value.
 */
const storedUsageWindowSchema = harnessUsageWindowSchema.extend({
  checkedAt: z.number(),
  origin: z.string().default("read"),
});

/**
 * One harness's usage record. Every field defaults (BP-023/BP-030), so a row
 * written under an older shape still parses rather than blanking.
 */
export const harnessUsageStateSchema = z.object({
  /** `windows` holds numbers; the other three say why there are none. */
  status: z.enum(["windows", "api-key", "signed-out", "unavailable"]).default("unavailable"),
  /** Why there is no number, for a person. `null` with windows. */
  reason: z.string().nullable().default("Not checked yet"),
  /** `hashKeySegment` of the vendor's account id, or `null`. Never the id or an email. */
  account: z.string().nullable().default(null),
  plan: z.string().nullable().default(null),
  windows: z.array(storedUsageWindowSchema).default([]),
  /** When the stored reading was made, in epoch ms. `null` until one was. */
  checkedAt: z.number().nullable().default(null),
  /** When a reader was last started, success or not. The throttle's clock. */
  lastAttemptAt: z.number().nullable().default(null),
  /** Why the last attempt failed, in plain words. `null` after a good one. */
  refreshError: z.string().nullable().default(null),
});

export type HarnessUsageState = z.infer<typeof harnessUsageStateSchema>;

/**
 * The collection. `llmWritable: false`: the writer below is its only writer.
 * Not client-readable: the query is the read path.
 */
export const harnessUsageCollection = defineResourceCollection({
  pattern: `${HARNESS_USAGE}/**`,
  // A person's own subscriptions, at the run record's scope and principal.
  scope: "user",
  // BP-027: a user-scoped collection defaults to shared across flows.
  flowIsolation: false,
  // Never loaded on a run that doesn't read it.
  prefetchMode: "lazy",
  stateSchema: harnessUsageStateSchema,
  llmWritable: false,
});

/** The collection, installed on the action that reads it. */
const harnessUsageCapability = defineCapability({
  name: "harness-manager:usage",
  resources: { [HARNESS_USAGE]: harnessUsageCollection },
});

/** What {@link recordHarnessUsage} did with a reading. */
export type UsageWrite = "recorded" | "kept-stored" | "refused-older";

/**
 * Record one reading of `harness`'s usage, made at `checkedAt` (epoch ms).
 *
 * @returns `recorded` when the reading replaced the record; `kept-stored`
 *   when it was `unavailable` over a stored reading, which stays (its reason
 *   becomes `refreshError`); `refused-older` when the stored reading is newer.
 */
export async function recordHarnessUsage(
  ctx: BlockContext,
  harness: string,
  reading: HarnessUsageReading,
  checkedAt: number,
): Promise<UsageWrite> {
  const record = await rowOf(ctx, harness);
  const outcome = await updateStateWith<Record<string, unknown>, UsageWrite>(record, (current) => {
    const stored = harnessUsageStateSchema.parse(current ?? {});
    if (stored.checkedAt !== null && checkedAt < stored.checkedAt) return { state: current, result: "refused-older" };
    if (reading.status === "unavailable" && stored.checkedAt !== null && stored.status !== "unavailable") {
      return { state: { ...current, refreshError: reading.reason }, result: "kept-stored" };
    }
    const next: HarnessUsageState = {
      ...stored,
      status: reading.status,
      reason: reading.status === "windows" ? null : reading.reason,
      account: reading.status === "windows" && reading.accountId !== null ? hashKeySegment(reading.accountId) : null,
      plan: reading.status === "windows" ? reading.plan : null,
      windows:
        reading.status === "windows" ? reading.windows.map((window) => ({ ...window, checkedAt, origin: "read" })) : [],
      checkedAt,
      refreshError: reading.status === "unavailable" ? reading.reason : null,
    };
    return { state: next as unknown as Record<string, unknown>, result: "recorded" };
  });
  return outcome ?? "refused-older";
}

/** One window as the query returns it: the stored reading, its age, and whether its reset has passed. */
export type HarnessUsageWindowRow = z.infer<typeof storedUsageWindowSchema> & { ageMs: number; rolledOver: boolean };

/** One harness as the query returns it. */
export interface HarnessUsageRow {
  harness: string;
  status: HarnessUsageState["status"];
  reason: string | null;
  plan: string | null;
  windows: HarnessUsageWindowRow[];
  checkedAt: number | null;
  /** How old the stored reading is, or `null` when there is none. */
  ageMs: number | null;
  refreshError: string | null;
}

const usageWindowRowSchema = storedUsageWindowSchema.extend({ ageMs: z.number(), rolledOver: z.boolean() });
const usageRowSchema = z.object({
  harness: z.string(),
  status: z.enum(["windows", "api-key", "signed-out", "unavailable"]),
  reason: z.string().nullable(),
  plan: z.string().nullable(),
  windows: z.array(usageWindowRowSchema),
  checkedAt: z.number().nullable(),
  ageMs: z.number().nullable(),
  refreshError: z.string().nullable(),
});

/**
 * Every harness's stored usage, with ages and roll-overs worked out at `now`.
 * Starts nothing. `expected` names harnesses to list even with no row yet
 * (the registered readers), so a harness nobody has read still shows.
 */
export async function readHarnessUsage(
  ctx: BlockContext,
  now: number,
  expected: readonly string[] = [],
): Promise<HarnessUsageRow[]> {
  const stored = new Map<string, HarnessUsageState>();
  for (const ref of await collectionOf(ctx).list()) {
    stored.set(harnessFromPath(ref.path), harnessUsageStateSchema.parse(ref.state ?? {}));
  }
  for (const harness of expected) {
    const key = assertSafeSegment("harness", harness);
    if (!stored.has(key)) stored.set(key, harnessUsageStateSchema.parse({}));
  }
  return [...stored.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([harness, state]) => ({
      harness,
      status: state.status,
      reason: state.reason,
      plan: state.plan,
      windows: state.windows.map((window) => ({
        ...window,
        ageMs: Math.max(0, now - window.checkedAt),
        rolledOver: window.resetsAt !== null && window.resetsAt < now,
      })),
      checkedAt: state.checkedAt,
      ageMs: state.checkedAt === null ? null : Math.max(0, now - state.checkedAt),
      refreshError: state.refreshError,
    }));
}

/** Options for {@link harnessUsageAction}. */
export interface HarnessUsageActionOptions {
  /**
   * One reader per harness, keyed by the harness's name (`codex`). Each runs
   * only when a caller asks for `refresh`. A harness with no reader is still
   * listed when something has written its row.
   */
  readers: Readonly<Record<string, HarnessUsageReader>>;
  /** How long a reader may take before the query reads `unavailable`. Default {@link USAGE_READ_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * The `harnessUsage` query, as one flow-level action a host puts on exactly
 * one flow: `actions: { harnessUsage: harnessUsageAction({ readers }) }`.
 *
 * Input `{ refresh?: boolean }`. Output `{ harnesses }`, one
 * {@link HarnessUsageRow} per harness. Zero-model. A refresh that fails or
 * times out still answers, with the stored rows and a `refreshError`.
 */
export function harnessUsageAction(options: HarnessUsageActionOptions) {
  const readers = Object.fromEntries(
    Object.entries(options.readers).map(([harness, reader]) => [assertSafeSegment("harness", harness), reader]),
  );
  const timeoutMs = options.timeoutMs ?? USAGE_READ_TIMEOUT_MS;
  // One call in flight per person and harness, shared by every refresh that asks meanwhile.
  // The map lives in this process: another host process keeps its own, and only the
  // once-a-minute claim on the stored row holds across them.
  const inFlight = new Map<string, Promise<void>>();

  const refreshOne = (ctx: BlockContext, harness: string, reader: HarnessUsageReader): Promise<void> => {
    const flight = `${userOf(ctx)}\u0000${harness}`;
    const running = inFlight.get(flight);
    if (running !== undefined) return running;
    const started = (async () => {
      if (!(await claimAttempt(ctx, harness, Date.now()))) return;
      const reading = await readWithin(reader, harness, timeoutMs);
      await recordHarnessUsage(ctx, harness, reading, Date.now());
    })().finally(() => inFlight.delete(flight));
    inFlight.set(flight, started);
    return started;
  };

  return {
    description:
      "How much of each coding harness's subscription is used: every window's percent and reset, " +
      "with how old the reading is. `refresh: true` asks the harness first, at most once a minute.",
    block: handler({
      name: "harness-usage",
      inputSchema: z.object({ refresh: z.boolean().optional() }),
      outputSchema: z.object({ harnesses: z.array(usageRowSchema) }),
      uses: [harnessUsageCapability],
      execute: async (input, ctx: BlockContext) => {
        if (input.refresh === true) {
          await Promise.all(Object.entries(readers).map(([harness, reader]) => refreshOne(ctx, harness, reader)));
        }
        return { harnesses: await readHarnessUsage(ctx, Date.now(), Object.keys(readers)) };
      },
    }),
  };
}


/**
 * Take this minute's attempt for `harness`, or refuse when the last attempt,
 * good or not, was under a minute ago. A compare-and-swap, so two refreshes
 * that race for one attempt get one.
 */
async function claimAttempt(ctx: BlockContext, harness: string, now: number): Promise<boolean> {
  const ref = await rowOf(ctx, harness);
  const claimed = await updateStateWith<Record<string, unknown>, boolean>(ref, (current) => {
    const stored = harnessUsageStateSchema.parse(current ?? {});
    if (stored.lastAttemptAt !== null && now - stored.lastAttemptAt < USAGE_REFRESH_EVERY_MS) {
      return { state: current, result: false };
    }
    return { state: { ...current, lastAttemptAt: now }, result: true };
  });
  return claimed === true;
}

/** Run one reader, reading `unavailable` with a plain reason when it is slow or throws. */
async function readWithin(reader: HarnessUsageReader, harness: string, timeoutMs: number): Promise<HarnessUsageReading> {
  const name = harness.charAt(0).toUpperCase() + harness.slice(1);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<HarnessUsageReading>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ status: "unavailable", reason: `${name} did not answer within ${timeoutMs / 1000} s` });
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => reader({ signal: controller.signal }))
        .catch(
        (): HarnessUsageReading => ({ status: "unavailable", reason: `${name}'s usage could not be read` }),
      ),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The caller's user id, which the collection's scope is keyed on. */
function userOf(ctx: BlockContext): string {
  return String((ctx.user as { identity?: { userId?: unknown } } | undefined)?.identity?.userId ?? "");
}

/** Strip the injected `harness-usage/` prefix a stored path carries. */
function harnessFromPath(path: string): string {
  const lead = `${HARNESS_USAGE}/`;
  return path.startsWith(lead) ? path.slice(lead.length) : path;
}

/** One record, created empty when missing, ready for a conditional write. */
async function rowOf(ctx: BlockContext, harness: string): Promise<UsageRef> {
  const key = assertSafeSegment("harness", harness);
  const collection = collectionOf(ctx);
  await collection.upsert(key, {}, {});
  const ref = await collection.getOptional(key);
  if (ref === undefined) throw new Error(`[harness-manager] the usage record for "${key}" was not created`);
  return ref;
}

/** One instance of the collection, with the conditional write. */
interface UsageRef {
  path: string;
  state: unknown;
  updateState(updater: (current: Record<string, unknown>) => Record<string, unknown>): Promise<void>;
}

/** The slice of the collection this module uses. Structural, like `inbox`. */
interface UsageCollectionRef {
  getOptional(key: string): Promise<UsageRef | undefined>;
  upsert(key: string, update: Record<string, unknown>, createOnly?: Record<string, unknown>): Promise<unknown>;
  list(prefix?: string): Promise<UsageRef[]>;
}

/** Resolve the collection, failing loudly when the flow doesn't install it. */
function collectionOf(ctx: BlockContext): UsageCollectionRef {
  const ref = (ctx.resources as Record<string, unknown> | undefined)?.[HARNESS_USAGE];
  if (ref === undefined || typeof (ref as UsageCollectionRef).upsert !== "function") {
    throw new Error(
      `[harness-manager] the "${HARNESS_USAGE}" collection is not registered on this flow; ` +
        `install it with harnessUsageAction rather than reading usage some other way.`,
    );
  }
  return ref as UsageCollectionRef;
}
