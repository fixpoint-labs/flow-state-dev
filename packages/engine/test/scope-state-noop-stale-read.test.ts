/**
 * Scope-state no-op skip must be verified against the store.
 *
 * Two execution contexts share one store. Context B reads a value, context A
 * replaces it, then B deliberately writes the value it first read back. B's
 * cached copy still equals that value, so a no-op check decided against the
 * cache alone would skip the write, return `false`, and leave A's value
 * stored. The write is a real one and must land.
 *
 * The genuine no-op (cache current, value unchanged) must stay a no-op: no
 * store write, no version bump, `false`.
 *
 * The re-read is asynchronous, and session/user/org writes are not serialized,
 * so another write in the same context can land while it is in flight. What
 * the re-read returns must never replace a newer cached copy: with no retries
 * left, that older copy would be what the context keeps reading.
 */

import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  ConcurrentModificationError,
  createExecutionContext,
  createInMemoryStores
} from "../src";
import { createScopeReread } from "../src/stores/scope-persist";

type Mode = { mode: string };

function createFlow(cas?: { maxRetries: number }) {
  const block = handler<{ value: string }, { ok: boolean }>({
    name: "noop-handler",
    execute: () => ({ ok: true })
  });

  return defineFlow({
    kind: "noop-stale-flow",
    ...(cas === undefined ? {} : { session: { cas }, user: { cas }, org: { cas } }),
    actions: {
      run: { inputSchema: z.object({ value: z.string() }), block }
    }
  })();
}

const SCOPES = ["session", "user", "org"] as const;
type Scope = (typeof SCOPES)[number];

async function openContext(
  stores: ReturnType<typeof createInMemoryStores>,
  requestId: string,
  cas?: { maxRetries: number }
) {
  return createExecutionContext({
    orgId: DEFAULT_ORG_ID,
    flow: createFlow(cas),
    actionName: "run",
    requestId,
    sessionId: "sess_noop",
    userId: "user_noop",
    stores,
    sessionState: { mode: "chat" },
    userState: { mode: "chat" },
    orgState: { mode: "chat" }
  });
}

type Ctx = Awaited<ReturnType<typeof openContext>>;

function scopeOf(ctx: Ctx, scope: Scope) {
  const handle = scope === "session" ? ctx.session : scope === "user" ? ctx.user : ctx.org;
  if (handle === undefined) throw new Error(`no ${scope} scope`);
  return handle as unknown as {
    readonly state: Mode;
    atomicState(fn: (s: Mode) => Mode): Promise<boolean>;
    setState(next: Mode): Promise<boolean>;
  };
}

async function stored(
  stores: ReturnType<typeof createInMemoryStores>,
  scope: Scope
): Promise<{ state: Mode; version: number }> {
  const record =
    scope === "session"
      ? await stores.session.get("sess_noop")
      : scope === "user"
        ? await stores.user.get("user_noop")
        : await stores.org.get(DEFAULT_ORG_ID);
  if (record === undefined) throw new Error(`no ${scope} record`);
  return { state: record.state as Mode, version: record.version };
}

describe.each(SCOPES)("%s scope: no-op skip against a stale cached read", (scope) => {
  it("lands a deliberate write that only equals this context's stale copy", async () => {
    const stores = createInMemoryStores();
    // Seed the record so both contexts load the same stored value.
    const seed = await openContext(stores, "req_seed");
    await scopeOf(seed, scope).setState({ mode: "chat" });

    const writerB = await openContext(stores, "req_b"); // reads mode: "chat"
    const writerA = await openContext(stores, "req_a");

    expect(await scopeOf(writerA, scope).atomicState(() => ({ mode: "agent" }))).toBe(true);
    expect((await stored(stores, scope)).state).toEqual({ mode: "agent" });

    // B restores "chat". Its cache still says "chat", the store says "agent".
    const committed = await scopeOf(writerB, scope).atomicState(() => ({ mode: "chat" }));

    expect((await stored(stores, scope)).state).toEqual({ mode: "chat" });
    expect(committed).toBe(true);
  });

  it("still skips a genuine no-op: no write, no version bump, false", async () => {
    const stores = createInMemoryStores();
    const seed = await openContext(stores, "req_seed");
    await scopeOf(seed, scope).setState({ mode: "chat" });

    const writer = await openContext(stores, "req_only");
    const before = await stored(stores, scope);

    const committed = await scopeOf(writer, scope).atomicState(() => ({ mode: "chat" }));

    expect(committed).toBe(false);
    expect(await stored(stores, scope)).toEqual(before);
  });
});

type Gettable = { get(id: string): Promise<unknown> };

/**
 * Holds the next `get` on `store` open. `snapshot()` reads the store at that
 * moment; `release()` resolves the held call with that snapshot. Later calls
 * go straight through.
 */
function holdNextGet(store: Gettable) {
  const original = store.get.bind(store);
  let snapshot!: () => Promise<void>;
  let release!: () => void;
  let markEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  store.get = (id: string) => {
    store.get = original;
    return new Promise((resolve) => {
      let value: unknown;
      snapshot = async () => {
        value = await original(id);
      };
      release = () => resolve(value);
      markEntered();
    });
  };
  return { entered, snapshot: () => snapshot(), release: () => release() };
}

function storeOf(stores: ReturnType<typeof createInMemoryStores>, scope: Scope): Gettable {
  return scope === "session" ? stores.session : scope === "user" ? stores.user : stores.org;
}

describe.each(SCOPES)("%s scope: an in-flight no-op re-read", (scope) => {
  it("never replaces a newer cached copy with the older one it read", async () => {
    const stores = createInMemoryStores();
    const seed = await openContext(stores, "req_seed");
    await scopeOf(seed, scope).setState({ mode: "chat" });

    // No retries, so whatever the failed attempt leaves cached is what stays.
    const ctx = await openContext(stores, "req_one", { maxRetries: 0 });
    const ops = scopeOf(ctx, scope);
    const held = holdNextGet(storeOf(stores, scope));

    // A no-op against the cache: its re-read is held open.
    const noop = ops.atomicState(() => ({ mode: "chat" }));
    await held.entered;

    // A second write lands; the re-read sees it. A third lands after that.
    expect(await ops.atomicState(() => ({ mode: "second" }))).toBe(true);
    await held.snapshot();
    expect(await ops.atomicState(() => ({ mode: "third" }))).toBe(true);

    held.release();
    await expect(noop).rejects.toBeInstanceOf(ConcurrentModificationError);

    expect((await stored(stores, scope)).state).toEqual({ mode: "third" });
    expect(ops.state).toEqual({ mode: "third" });
  });
});

describe("createScopeReread", () => {
  type Rec = { id: string; state: Mode; version: number };

  it("does not move the held record back to an older version", async () => {
    const ref: { current: Rec | undefined } = {
      current: { id: "r", state: { mode: "one" }, version: 1 }
    };
    let resolveGet!: (record: Rec) => void;
    const reread = createScopeReread<Mode, Rec>(ref, {
      get: () =>
        new Promise<Rec>((resolve) => {
          resolveGet = resolve;
        })
    });

    const pending = reread();
    // A write in the same context lands version 3 while the read is open.
    ref.current = { id: "r", state: { mode: "three" }, version: 3 };
    resolveGet({ id: "r", state: { mode: "two" }, version: 2 });

    expect(await pending).toEqual({ state: { mode: "two" }, version: 2 });
    expect(ref.current).toEqual({ id: "r", state: { mode: "three" }, version: 3 });
  });

  it("adopts a newer stored record", async () => {
    const ref: { current: Rec | undefined } = {
      current: { id: "r", state: { mode: "one" }, version: 1 }
    };
    const newer = { id: "r", state: { mode: "two" }, version: 2 };
    const reread = createScopeReread<Mode, Rec>(ref, { get: async () => newer });

    await reread();
    expect(ref.current).toEqual(newer);
  });
});
