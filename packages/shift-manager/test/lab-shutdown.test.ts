import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StoreAdapter, StoreRegistry } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { INTAKE_SESSION_ID } from "@flow-state-dev/workforce";
import { harnessStub } from "../teams/devteam/harness-stub.mts";
import { errorReporterHarness } from "../teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab } from "../teams/devteam/host.mts";

type Seen = { closed: boolean; writesAfterClose: string[]; intakeHeld: Promise<void>; release: () => void };

/**
 * SQLite stores that hold the next intake-session read until `release()`, and
 * record any request write that arrives after `dispose()` closed them.
 */
function watchedStores(filename: string): { adapter: StoreAdapter; seen: Seen; arm: () => void } {
  const inner = sqliteStores({ filename });
  let armed = false;
  let reached!: () => void;
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const seen: Seen = {
    closed: false,
    writesAfterClose: [],
    intakeHeld: new Promise<void>((r) => (reached = r)),
    release: () => release(),
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
          persistItems: (requestId: string, items: Parameters<typeof request.persistItems>[1]) => {
            if (seen.closed) seen.writesAfterClose.push(`items ${requestId}`);
            return request.persistItems(requestId, items);
          },
          persistEvents: (requestId: string, events: Parameters<typeof request.persistEvents>[1]) => {
            if (seen.closed) seen.writesAfterClose.push(`events ${requestId}`);
            return request.persistEvents(requestId, events);
          },
        },
      } as StoreRegistry;
    },
    dispose() {
      seen.closed = true;
      return inner.dispose?.();
    },
  };
  return { adapter, seen, arm: () => (armed = true) };
}

/** Let pending callbacks and I/O run, `turns` times over. No wall-clock wait. */
async function yieldTurns(turns: number): Promise<void> {
  for (let i = 0; i < turns; i += 1) await new Promise<void>((r) => setImmediate(r));
}

async function openWatchedLab() {
  const dir = mkdtempSync(join(tmpdir(), "sm-lab-shutdown-"));
  const { adapter, seen, arm } = watchedStores(join(dir, "lab.sqlite"));
  const lab = await openLab({
    stores: adapter,
    harness: harnessStub({}).slot,
    workspace: { root: join(dir, "runs"), remotes: { allow: ["file"] } },
    coderWorkerId: "eng.coder",
    errorReporter: { harness: errorReporterHarness, cwd: dir },
    log: () => {},
  });
  arm();
  lab.errorReporter!.capture({
    final: true,
    requestId: "req_failed_before_shutdown",
    flowKind: "em",
    actionName: "onTaskSettled",
    userId: LAB_USER_ID,
    orgId: LAB_ORG_ID,
    error: { message: "the judge gave no verdict" },
  });
  await seen.intakeHeld;
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
});
