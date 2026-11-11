/**
 * A finished request leaves nothing behind in the SQLite request store's
 * memory.
 *
 * While a request runs, the store remembers what it last wrote for each of
 * the request's items, so the next write carries only what changed. That
 * memory is only worth holding while the request can still write: kept past
 * the run, it is a serialized copy of the request's whole item log, held for
 * the life of the server. The run still writes after its terminal status
 * (`request.onFinished`, side-chain drains, request-end hooks, its own
 * observer traces), and a terminal write can fail, so the memory has to go
 * when the run is over, however it ended.
 *
 * The probe: with the request's rows removed behind the store's back, a store
 * that still remembers the items skips re-persisting the same items (nothing
 * changed, as far as it knows), and one that has forgotten them writes them.
 */
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { RuntimeItem } from "@flow-state-dev/core/internal";
import { runAction } from "@flow-state-dev/engine";
import type { RequestStore } from "@flow-state-dev/engine/host";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createSQLiteStores, type SQLiteStoreRegistry } from "../src/host";

/** A flow whose `request.onFinished` emits a durable item after the terminal write. */
function flowWithFinishingObserver() {
  return defineFlow({
    kind: "finishing-observer",
    request: {
      onFinished: handler({
        name: "finishing-note",
        execute: (_input: unknown, ctx) => {
          ctx.emit.message("written after the terminal status");
          return { noted: true };
        }
      })
    },
    actions: {
      run: {
        inputSchema: z.object({}),
        block: handler({
          name: "finishing-run",
          execute: (_input: unknown, ctx) => {
            ctx.emit.message("written while running");
            return { ok: true };
          }
        })
      }
    }
  } as never)({ id: "finishing-observer" });
}

/** Keep the last item snapshot the run handed `persistItems`. */
function recordLastPersisted(store: RequestStore): () => RuntimeItem[] {
  let last: RuntimeItem[] = [];
  const persistItems = store.persistItems.bind(store);
  store.persistItems = (requestId, items) => {
    last = [...items];
    persistItems(requestId, items);
  };
  return () => last;
}

describe("SQLite request store: a finished request's item memory", () => {
  let dir: string;
  let filename: string;
  let stores: SQLiteStoreRegistry;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // With trace observability on, the observer's own block_trace is a
    // durable item written after the terminal status too.
    process.env.FSDEV_TRACE_OBSERVABILITY = "true";
    dir = mkdtempSync(join(tmpdir(), "fsd-item-tracking-"));
    filename = join(dir, "request.db");
    stores = createSQLiteStores({ filename });
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    stores.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Whether the store still remembers `items` as written for `requestId`. */
  async function remembers(requestId: string, items: RuntimeItem[]): Promise<boolean> {
    const raw = new Database(filename);
    raw.prepare("DELETE FROM request_items WHERE request_id = ?").run(requestId);
    raw.close();
    stores.request.persistItems(requestId, items);
    await stores.request.flushItems(requestId);
    await new Promise((resolve) => setImmediate(resolve));
    return (await stores.request.countItems(requestId)) === 0;
  }

  it("remembers a running request's items, so only changes are written (the probe's control)", async () => {
    const requestId = "req_running_tracking";
    const now = Date.now();
    await stores.request.set(
      requestId,
      {
        id: requestId,
        flowKind: "f",
        actionName: "a",
        source: "http",
        userId: "u1",
        sessionId: "s1",
        status: "in_progress",
        startedAtMs: now,
        state: {},
        version: 0,
        createdAt: now,
        updatedAt: now
      },
      "any"
    );
    const items = [
      { id: "item_1", type: "message", status: "done", requestId, itemIndex: 0, role: "assistant", content: [] }
    ] as unknown as RuntimeItem[];
    stores.request.persistItems(requestId, items);
    await stores.request.flushItems(requestId);
    expect(await stores.request.countItems(requestId)).toBe(1);

    expect(await remembers(requestId, items)).toBe(true);
  });

  it("forgets a request's items once it has finished, though onFinished wrote after the terminal status", async () => {
    const requestId = "req_finished_tracking";
    const lastPersisted = recordLastPersisted(stores.request);

    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: flowWithFinishingObserver(),
      actionName: "run",
      input: {},
      requestId,
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: {}
    });
    expect(result.error).toBeUndefined();
    expect((await stores.request.get(requestId))?.status).toBe("completed");

    // The run did write after its terminal status, or this proves nothing.
    const snapshot = lastPersisted();
    expect(
      snapshot.some(
        (item) =>
          item.type === "message" &&
          JSON.stringify(item).includes("written after the terminal status")
      )
    ).toBe(true);

    expect(await remembers(requestId, snapshot)).toBe(false);
  });

  it("forgets a request's items once it has finished, though its terminal write threw", async () => {
    const requestId = "req_failed_settle_tracking";
    const lastPersisted = recordLastPersisted(stores.request);
    const set = stores.request.set.bind(stores.request);
    let refused = 0;
    stores.request.set = async (id, value, expectedVersion) => {
      if (id === requestId && value.status !== "in_progress") {
        refused += 1;
        throw new Error("terminal write failed");
      }
      return set(id, value, expectedVersion);
    };

    await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: flowWithFinishingObserver(),
      actionName: "run",
      input: {},
      requestId,
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: {}
    }).catch(() => undefined);
    stores.request.set = set;
    expect(refused).toBeGreaterThan(0);

    // The run's items reached the store while it ran.
    const snapshot = lastPersisted();
    expect(snapshot.length).toBeGreaterThan(0);

    expect(await remembers(requestId, snapshot)).toBe(false);
  });
});
