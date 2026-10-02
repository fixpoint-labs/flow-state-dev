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
 */

import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createExecutionContext, createInMemoryStores } from "../src";

type Mode = { mode: string };

function createFlow() {
  const block = handler<{ value: string }, { ok: boolean }>({
    name: "noop-handler",
    execute: () => ({ ok: true })
  });

  return defineFlow({
    kind: "noop-stale-flow",
    actions: {
      run: { inputSchema: z.object({ value: z.string() }), block }
    }
  })();
}

const SCOPES = ["session", "user", "org"] as const;
type Scope = (typeof SCOPES)[number];

async function openContext(
  stores: ReturnType<typeof createInMemoryStores>,
  requestId: string
) {
  return createExecutionContext({
    orgId: DEFAULT_ORG_ID,
    flow: createFlow(),
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
