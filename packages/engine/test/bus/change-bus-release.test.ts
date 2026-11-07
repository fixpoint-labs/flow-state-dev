/**
 * What the change bus must not hold or hide (FIX-2426 review):
 *
 * - a failed item write stays visible to an explicit `flushItems` through the
 *   wrapper, as on the raw store, though the wrapper flushed in the background
 *   to time its notice;
 * - a session stream whose reader goes away lets go of its bus subscriptions
 *   at once, not at its next ping or its age limit.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  disposeFlowApiRouter
} from "../../src";
import {
  createInMemoryBus,
  withChangeBus,
  type ChangeBus,
  type ChangeNotice,
  type SessionRecord
} from "../../src/host";
import { createFilesystemRequestStore } from "../../src/stores/filesystem/request-store";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("withChangeBus · a failed item write", () => {
  let scratch: string;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    scratch = await mkdtemp(path.join(tmpdir(), "fsd-bus-flush-"));
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleError.mockRestore();
    await rm(scratch, { recursive: true, force: true });
  });

  /** A filesystem request store whose every write fails (its root sits under a file). */
  async function failingRequestStore() {
    const blocker = path.join(scratch, "not-a-dir");
    await writeFile(blocker, "x", "utf8");
    return createFilesystemRequestStore({ rootDir: path.join(blocker, "requests") });
  }

  const item = { id: "item_0", type: "message", role: "assistant", content: [] } as never;

  it("still rejects a later explicit flush, as the raw store does", async () => {
    // The raw store: the flush a caller waits on rejects.
    const raw = await failingRequestStore();
    raw.persistItems("req_items", [item]);
    await expect(raw.flushItems("req_items")).rejects.toBeInstanceOf(Error);

    // Through the wrapper, after its background flush has run.
    const bus = createInMemoryBus();
    const heard: ChangeNotice[] = [];
    bus.subscribe({ scope: "session", id: "s1", tenantId: "" }, (n) => heard.push(n));
    const stores = withChangeBus({ ...createInMemoryStores(), request: await failingRequestStore(), bus });
    stores.request.persistItems("req_items", [item]);
    for (let i = 0; i < 5; i += 1) await tick();
    await expect(stores.request.flushItems("req_items")).rejects.toBeInstanceOf(Error);
    // Reported once, as on the raw store.
    await expect(stores.request.flushItems("req_items")).resolves.toBeUndefined();
    // Nothing landed, so nothing is announced.
    expect(heard).toEqual([]);
  });

  it("rejects an explicit flush made while the background flush is still running", async () => {
    const stores = withChangeBus({ ...createInMemoryStores(), request: await failingRequestStore() });
    stores.request.persistItems("req_now", [item]);
    await expect(stores.request.flushItems("req_now")).rejects.toBeInstanceOf(Error);
  });
});

describe("the session stream · a reader that goes away", () => {
  /** A bus that says it crosses, counting the subscriptions it holds. */
  function countingBus(): ChangeBus & { held(): number } {
    const inner = createInMemoryBus();
    let held = 0;
    const counted = <T extends unknown[]>(open: (...args: T) => () => void) => (...args: T) => {
      const stop = open(...args);
      held += 1;
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        held -= 1;
        stop();
      };
    };
    return {
      crossesProcesses: true,
      publish: (notice) => inner.publish(notice),
      subscribe: counted((topic, listener) => inner.subscribe(topic, listener)),
      onCrossingChange: counted(() => () => {}),
      held: () => held
    };
  }

  it("releases its notice and crossing subscriptions as soon as the response is cancelled", async () => {
    const bus = countingBus();
    const stores = { ...createInMemoryStores(), bus };
    const now = Date.now();
    await stores.session.set(
      "s1",
      { orgId: DEFAULT_ORG_ID, id: "s1", flowKind: "chat", userId: "alice", state: {}, version: 0, createdAt: now, updatedAt: now, journal: [] } as SessionRecord,
      "any"
    );
    const registry = createFlowRegistry();
    registry.register(defineFlow({ kind: "chat", actions: { say: { block: handler({ name: "say", execute: () => ({}) }) } } })());
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    try {
      // The request is never aborted: only its response body is cancelled.
      const response = await router.GET(new Request("http://localhost/api/flows/sessions/s1/stream"), {
        params: { path: ["sessions", "s1", "stream"] }
      });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      await reader.read(); // the opening `session.runs`
      await delay(50);
      expect(bus.held()).toBe(2);

      await reader.cancel();
      await delay(200);
      expect(bus.held()).toBe(0);
    } finally {
      await disposeFlowApiRouter(router);
    }
  });
});
