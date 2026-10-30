import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StoreAdapter, StoreRegistry } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { handler, harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { INTAKE_SESSION_ID } from "@flow-state-dev/workforce";
import { harnessStub } from "@flow-state-dev/harness-manager";
import { errorReporterHarness } from "../teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab } from "../teams/devteam/host.mts";

type Seen = {
  closed: boolean;
  writesAfterClose: string[];
  intakeHeld: Promise<void>;
  release: () => void;
  writeHeld: Promise<void>;
  releaseWrite: () => void;
};

/**
 * SQLite stores that hold the next intake-session read until `release()`, hold
 * the next request write after `armWrite()` until `releaseWrite()`, and record
 * any request write that arrives after `dispose()` closed them.
 */
function watchedStores(filename: string): { adapter: StoreAdapter; seen: Seen; arm: () => void; armWrite: () => void } {
  const inner = sqliteStores({ filename });
  let armed = false;
  let writeArmed = false;
  let reached!: () => void;
  let release!: () => void;
  let writeReached!: () => void;
  let releaseWrite!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const writeGate = new Promise<void>((r) => (releaseWrite = r));
  const seen: Seen = {
    closed: false,
    writesAfterClose: [],
    intakeHeld: new Promise<void>((r) => (reached = r)),
    release: () => release(),
    writeHeld: new Promise<void>((r) => (writeReached = r)),
    releaseWrite: () => releaseWrite(),
  };
  // A held write stays pending in the store, so the store's flush waits for it too.
  let pending: Promise<void> = Promise.resolve();
  const questionWrite = async () => {
    if (!writeArmed) return pending;
    writeArmed = false;
    writeReached();
    pending = writeGate;
    await writeGate;
  };
  const adapter: StoreAdapter = {
    capabilities: inner.capabilities,
    async resolve(slots) {
      const stores = (await inner.resolve(slots)) as StoreRegistry;
      const request = stores.request;
      const session = stores.session;
      return {
        ...stores,
        session: {
          ...session,
          get: async (...args: Parameters<typeof session.get>) => {
            if (armed && args[0] === INTAKE_SESSION_ID) {
              armed = false;
              reached();
              await held;
            }
            return session.get(...args);
          },
        },
        request: {
          ...request,
          persistItems: async (requestId: string, items: Parameters<typeof request.persistItems>[1]) => {
            await questionWrite();
            if (seen.closed) seen.writesAfterClose.push(`items ${requestId}`);
            return request.persistItems(requestId, items);
          },
          persistEvents: async (requestId: string, events: Parameters<typeof request.persistEvents>[1]) => {
            await questionWrite();
            if (seen.closed) seen.writesAfterClose.push(`events ${requestId}`);
            return request.persistEvents(requestId, events);
          },
          flushEvents: async (requestId: string) => {
            await pending;
            return request.flushEvents(requestId);
          },
        },
      } as StoreRegistry;
    },
    dispose() {
      seen.closed = true;
      return inner.dispose?.();
    },
  };
  return { adapter, seen, arm: () => (armed = true), armWrite: () => (writeArmed = true) };
}

/** Let pending callbacks and I/O run, `turns` times over. No wall-clock wait. */
async function yieldTurns(turns: number): Promise<void> {
  for (let i = 0; i < turns; i += 1) await new Promise<void>((r) => setImmediate(r));
}

/**
 * A report harness that runs until its run is cancelled. On the abort it holds
 * the run's next write, so the run's ending is provably still unwritten when
 * the cancel lands.
 */
function runsUntilCancelled(armWrite: () => void) {
  let reached!: () => void;
  const started = new Promise<void>((r) => (reached = r));
  const harness = (): HarnessBlock =>
    handler({
      name: "lab-shutdown-report-harness",
      inputSchema: harnessRunInputSchema,
      outputSchema: harnessRunHandleSchema,
      execute: async (_input, ctx) => {
        reached();
        await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve(), { once: true }));
        armWrite();
        throw new Error("cancelled");
      },
    }) as unknown as HarnessBlock;
  return { harness, started };
}

async function openWatchedLab({ untilCancelled = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sm-lab-shutdown-"));
  const { adapter, seen, arm, armWrite } = watchedStores(join(dir, "lab.sqlite"));
  const report = untilCancelled ? runsUntilCancelled(armWrite) : undefined;
  const lab = await openLab({
    stores: adapter,
    harness: harnessStub({}).slot,
    workspace: { root: join(dir, "runs"), remotes: { allow: ["file"] } },
    coderWorkerId: "eng.coder",
    errorReporter: { harness: report?.harness ?? errorReporterHarness, cwd: dir },
    log: () => {},
  });
  if (report === undefined) arm();
  lab.errorReporter!.capture({
    final: true,
    requestId: "req_failed_before_shutdown",
    flowKind: "em",
    actionName: "onTaskSettled",
    userId: LAB_USER_ID,
    orgId: LAB_ORG_ID,
    error: { message: "the judge gave no verdict" },
  });
  await (report?.started ?? seen.intakeHeld);
  return { lab, seen };
}

describe("a Lab's shutdown with an Error Reporter run in flight", () => {
  it("waits for the run to settle before the stores close, so nothing writes to a closed store", async () => {
    const { lab, seen } = await openWatchedLab();

    const disposing = lab.state.dispose();
    await yieldTurns(50);
    expect(seen.closed, "the stores closed while the reporter's run was still in flight").toBe(false);

    seen.release();
    await disposing;
    expect(seen.closed).toBe(true);
    expect(seen.writesAfterClose).toEqual([]);
  }, 60_000);

  it("still closes the stores when the run never settles", async () => {
    const { lab, seen } = await openWatchedLab();
    const started = Date.now();
    await lab.state.dispose();
    expect(seen.closed).toBe(true);
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 60_000);

  it("cancels a run that outlasts the wait, and closes the stores only after it writes its ending", async () => {
    const { lab, seen } = await openWatchedLab({ untilCancelled: true });

    const disposing = lab.state.dispose();
    const cancelled = await Promise.race([seen.writeHeld.then(() => true), disposing.then(() => false)]);
    expect(cancelled, "the stores closed without the run being cancelled").toBe(true);
    await yieldTurns(50);
    expect(seen.closed, "the stores closed before the cancelled run wrote its ending").toBe(false);

    seen.releaseWrite();
    await disposing;
    expect(seen.closed).toBe(true);
    expect(seen.writesAfterClose).toEqual([]);
  }, 60_000);
});
