/**
 * FIX-687: behaviour of the shared per-request live-tail loop.
 *
 * The conformance suite (subscribe.test.ts) covers single-subscriber catch-up,
 * live delivery, abort, terminal, and liveness. These cases cover the
 * shared-loop-specific behaviour: N subscribers on one request all receive the
 * same ordered stream, a late joiner sees only events past its own cursor, and
 * aborting a subscriber tears down cleanly without leaking the loop.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  makeRequestStreamEvent,
  makeRequestCompletedEvent
} from "@flow-state-dev/server/testing";
import { createSQLiteRequestStore } from "../src/request-store";
import { initializeSchema } from "../src/schema";

const POLL_INTERVAL_MS = 25;

function freshStore(): { db: Database.Database; store: ReturnType<typeof createSQLiteRequestStore> } {
  const db = new Database(":memory:");
  initializeSchema(db);
  const store = createSQLiteRequestStore(db, { subscribePollIntervalMs: POLL_INTERVAL_MS });
  return { db, store };
}

/** Drain a subscription to completion, returning the sequence numbers seen. */
async function drainSequences(
  iter: AsyncIterableIterator<{ sequence_number: number }>
): Promise<number[]> {
  const seen: number[] = [];
  for await (const event of iter) seen.push(event.sequence_number);
  return seen;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("SQLite shared live-tail loop", () => {
  it("fans one shared loop out to multiple concurrent subscribers", async () => {
    const { db, store } = freshStore();
    const requestId = "req_fanout";

    const drains = Promise.all([
      drainSequences(store.subscribeToEvents(requestId, {})),
      drainSequences(store.subscribeToEvents(requestId, {})),
      drainSequences(store.subscribeToEvents(requestId, {}))
    ]);

    // Let the three subscribers register on the shared loop before writing.
    await flush();
    store.persistEvents(requestId, [
      makeRequestStreamEvent(requestId, 1),
      makeRequestStreamEvent(requestId, 2)
    ]);
    await flush();
    store.persistEvents(requestId, [makeRequestStreamEvent(requestId, 3)]);
    store.persistEvents(requestId, [makeRequestCompletedEvent(requestId, 4)]);

    const [a, b, c] = await drains;
    expect(a).toEqual([1, 2, 3, 4]);
    expect(b).toEqual([1, 2, 3, 4]);
    expect(c).toEqual([1, 2, 3, 4]);
    db.close();
  });

  it("delivers a late joiner only the events past its own cursor", async () => {
    const { db, store } = freshStore();
    const requestId = "req_late";

    const early = drainSequences(store.subscribeToEvents(requestId, {}));
    await flush();
    store.persistEvents(requestId, [
      makeRequestStreamEvent(requestId, 1),
      makeRequestStreamEvent(requestId, 2)
    ]);
    await flush();

    // Joins after seq 2; must not re-see 1 or 2.
    const late = drainSequences(store.subscribeToEvents(requestId, { fromSequence: 2 }));
    await flush();
    store.persistEvents(requestId, [makeRequestStreamEvent(requestId, 3)]);
    store.persistEvents(requestId, [makeRequestCompletedEvent(requestId, 4)]);

    expect(await early).toEqual([1, 2, 3, 4]);
    expect(await late).toEqual([3, 4]);
    db.close();
  });

  it("tears down the shared loop when a subscriber aborts", async () => {
    const { db, store } = freshStore();
    const requestId = "req_abort";

    const controller = new AbortController();
    const drained = drainSequences(
      store.subscribeToEvents(requestId, { signal: controller.signal })
    );
    await flush();
    store.persistEvents(requestId, [makeRequestStreamEvent(requestId, 1)]);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS * 2));

    controller.abort();
    // The iterator must complete after abort (no hang).
    const seen = await drained;
    expect(seen).toContain(1);

    // Writing after teardown must not throw or hang; a fresh subscriber still works.
    store.persistEvents(requestId, [makeRequestCompletedEvent(requestId, 2)]);
    const after = await drainSequences(store.subscribeToEvents(requestId, {}));
    expect(after).toEqual([1, 2]);
    db.close();
  });

  it("rejoining immediately after abort does not corrupt the shared loop", async () => {
    const { db, store } = freshStore();
    const requestId = "req_rejoin";

    // Abort the only subscriber, then resubscribe in the same tick — before the
    // aborted subscription's teardown has a chance to settle. This exercises the
    // teardown/rejoin window where a stale tail could otherwise be reused.
    const controller = new AbortController();
    const first = drainSequences(
      store.subscribeToEvents(requestId, { signal: controller.signal })
    );
    controller.abort();
    const second = drainSequences(store.subscribeToEvents(requestId, {}));

    await flush();
    store.persistEvents(requestId, [makeRequestStreamEvent(requestId, 1)]);
    store.persistEvents(requestId, [makeRequestCompletedEvent(requestId, 2)]);

    await first; // aborted subscription terminates cleanly (no hang)
    expect(await second).toEqual([1, 2]);
    db.close();
  });
});
