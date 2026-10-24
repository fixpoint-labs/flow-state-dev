/**
 * A task's notice held for the request that filed it reaches its filer after
 * that request's process dies mid-run (FIX-2166).
 *
 * FIX-2123 holds a notice while its filing request runs, so a wait in that
 * request reads the ending first. A request whose process died still reads
 * `in_progress` until the stale-request sweep marks it interrupted, and
 * nothing then sent the held notice before the pass's next resend, its
 * backoff (up to 5 minutes) later. Now the request reads as stopped once its
 * heartbeat is stale past the sweep's threshold, and the sweep that marks it
 * interrupted brings the filer's pass forward, so the notice is heard within
 * the threshold and one sweep tick of the request's last heartbeat.
 *
 * The crash is a seam: the first engine runs the filing turn and is then
 * abandoned, its model call never answering and its heartbeat never beating
 * again, with nothing ended or deregistered; a second engine starts on the
 * same stores. Short thresholds stand in for the defaults' minutes.
 *
 * Two cases, one per way the notice is freed: the sweep marking the request
 * interrupted and bringing the pass forward; and, with sweeping off, the pass
 * itself reading the request's stale heartbeat as stopped.
 *
 * Each runs on the in-memory stores and on SQLite.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, disposeFlowApiRouter, inMemoryStores, runAction, type StoreAdapter } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import type { TaskSettledInput } from "../../src";
import { act, fileCall, type Row, SESSION, stepModel, USER, waitFlow } from "./wait-fixture";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** Each case opens the same stores twice: once per engine, as a restarted server does. */
const STORES: ReadonlyArray<readonly [string, () => Promise<() => Promise<StoreAdapter>>]> = [
  [
    "in-memory",
    async () => {
      const shared = inMemoryStores();
      return async () => shared;
    }
  ],
  [
    "sqlite",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "fsd-notice-after-crash-"));
      dirs.push(dir);
      return async () => sqliteStores({ filename: join(dir, "store.db") });
    }
  ]
];

/** The sweep's stale threshold and cadence here: the defaults are 60 s and 30 s. */
const THRESHOLD_MS = 7_000;
const SWEEP_MS = 500;
/**
 * A wake brought forward fires within the durability sweep's 1 s floor, and
 * the pass and the notice's request then run: slack for a loaded machine,
 * still well short of the resend that would otherwise send it (14 s here).
 */
const PASS_MS = 3_000;

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function eventually<T>(read: () => Promise<T | undefined>, withinMs: number, what: string): Promise<T> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`${what}: not within ${withinMs} ms`);
    await settle(25);
  }
}

function engine(flow: FlowInstance, primary: StoreAdapter, sweepMs: number) {
  return createFlowState({
    flows: { "wait-board": flow },
    stores: { default: { primary } },
    durable: true,
    staleSweepThresholdMs: THRESHOLD_MS,
    staleSweepIntervalMs: sweepMs
  });
}

/**
 * A filing request left mid-run by a dead server, its task's notice held for
 * it, and a second server started on the same stores with the stale sweep at
 * `sweepMs` (0: off).
 */
async function crashAndRestart(open: () => Promise<StoreAdapter>, sweepMs: number) {
  const notices: TaskSettledInput[] = [];
  const heardAt: number[] = [];
  const heard = { heard: notices, heardGate: async () => void heardAt.push(Date.now()) };

  // The first server: the turn files a task that ends at once, then its
  // model call never answers. Its heartbeat beats once an hour, which here
  // is never: the request is left as a killed process leaves it.
  // The call answers only the teardown's abort, so the run ends before the
  // next test file: a run left hanging holds this process's request-end
  // drain, which every later host's shutdown waits on.
  const kill = new AbortController();
  const neverAnswers = (opts: { signal?: AbortSignal }) =>
    new Promise<never>((_, reject) => (opts.signal ?? kill.signal).addEventListener("abort", () => reject(new Error("killed")), { once: true }));
  const { model } = stepModel([fileCall("f1"), neverAnswers as never]);
  const first = engine(waitFlow(model, { endsOnFiling: "already done", heartbeatIntervalMs: 3_600_000, ...heard }), await open(), sweepMs);
  const firstRuntime = await first.getRuntime();
  const flow = firstRuntime.registry.get("wait-board")!;
  const abandoned = runAction({
    signal: kill.signal,
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: {},
    userId: USER,
    sessionId: SESSION,
    stores: firstRuntime.stores,
    runtimeConfig: firstRuntime.runtimeConfig
  }).catch(() => undefined);

  // The notice is turned away for the running filing request, as it is
  // while that request lives.
  const filing = await eventually(
    async () => {
      // Read without a router: the first server runs no sweeps, as a server about to die runs none we can count on.
      const listed = (await act(first, flow, "list", {}, { sweeper: false })).output as Row[];
      const meta = listed[0]?.metadata ?? {};
      const deferred = Object.entries(meta).find(([key]) => key.startsWith("noticeDeferred:"))?.[1] as { whileRunning?: string } | undefined;
      return deferred?.whileRunning;
    },
    10_000,
    "the notice was never held for its filing request"
  );
  const entry = await firstRuntime.stores.activeRequests.get(filing);
  expect(entry).toBeDefined();
  const lastBeat = entry!.lastHeartbeatAt;
  expect(notices).toEqual([]);

  // The restart: a second server on the same stores, nothing sent to it.
  // Its flow beats as a healthy one does, so a stale entry reads as stopped.
  const { model: idle } = stepModel([]);
  const second = engine(waitFlow(idle, { heartbeatIntervalMs: 1_000, ...heard }), await open(), sweepMs);
  const router = await second.getRouter();
  return {
    notices,
    statusOf: async () => (await (await second.getRuntime()).stores.request.get(filing))?.status,
    /** Resolves once the notice is heard, with how long after the request's last heartbeat. */
    heard: async (withinMs: number) => {
      await eventually(async () => (notices.length > 0 ? true : undefined), withinMs, "the notice was never heard");
      return heardAt[0]! - lastBeat;
    },
    dispose: async () => {
      kill.abort();
      const ended = await Promise.race([abandoned.then(() => true), settle(5_000).then(() => false)]);
      expect(ended, "the abandoned run ended at the teardown's abort").toBe(true);
      await disposeFlowApiRouter(router, { drainMs: 100 });
      await second.dispose();
      await first.dispose().catch(() => undefined);
    }
  };
}

describe.each(STORES)("a notice held for a filing request whose process died (%s)", { timeout: 60_000 }, (_name, open) => {
  it("is heard within the stale threshold and one sweep tick of that request's last heartbeat, not at its resend's backoff", async () => {
    const run = await crashAndRestart(await open(), SWEEP_MS);
    try {
      const sinceBeat = await run.heard(THRESHOLD_MS + 15_000);
      expect(run.notices).toEqual([expect.objectContaining({ ending: "completed", output: "already done" })]);
      // Not while the request could still be alive on another server: only
      // once its heartbeat is stale past the threshold the sweep reaps at.
      expect(sinceBeat).toBeGreaterThanOrEqual(THRESHOLD_MS);
      // And within one sweep tick and one pass of that, not at the backoff.
      expect(sinceBeat).toBeLessThanOrEqual(THRESHOLD_MS + SWEEP_MS + PASS_MS);
      // A pass that read the stale heartbeat may have sent it just before the
      // sweep's tick: the sweep marks the request all the same.
      await eventually(async () => ((await run.statusOf()) === "interrupted" ? true : undefined), SWEEP_MS + 2_000, "the sweep never marked the request");

      await settle(2_500);
      expect(run.notices).toHaveLength(1);
    } finally {
      await run.dispose();
    }
  });

  it("with the stale sweep off, is heard at the first resend after that request's heartbeat goes stale, though nothing marks it", async () => {
    // Nothing marks the request interrupted here, so only the pass's own read
    // of its heartbeat frees the notice. Its resends run about 2, 6 and 14 s
    // after the ending; the threshold falls between the second and the third.
    const run = await crashAndRestart(await open(), 0);
    try {
      const sinceBeat = await run.heard(THRESHOLD_MS + 15_000);
      expect(run.notices).toEqual([expect.objectContaining({ ending: "completed", output: "already done" })]);
      expect(sinceBeat).toBeGreaterThanOrEqual(THRESHOLD_MS);
      // At most one backoff step (8 s here) past the threshold, and its pass.
      expect(sinceBeat).toBeLessThanOrEqual(THRESHOLD_MS + 8_000 + PASS_MS);
      expect(await run.statusOf()).toBe("in_progress");

      await settle(2_500);
      expect(run.notices).toHaveLength(1);
    } finally {
      await run.dispose();
    }
  });
});

