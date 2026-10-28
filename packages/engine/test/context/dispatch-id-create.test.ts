/**
 * An `{ id }` dispatch target that carries starting state: the session is
 * created at that id when it is absent, through the same birth and create
 * check a `{ key }` target's child takes, and delivered into as an existing
 * session when it is present.
 *
 * Why it matters: a server block can then reach a session whose id it
 * computed (a per-user address) before any caller opened it, and a wrong id
 * is still judged by the target flow's own create check rather than written
 * blind. An `{ id }` with no state stays delivery-only (the seam test pins it).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { dispatchThroughSeam, markDispatcher } from "@flow-state-dev/core/types";
import type { SessionCreateCheckInput } from "@flow-state-dev/core/types";
import { z } from "zod";
import { createFlowState, inMemoryStores, runAction } from "../../src";
import type { FlowStateRuntime } from "../../src/flowstate/types";

const USER_ID = "u_id_create";

type Observed = {
  runs: { sessionId: string; input: unknown; state: unknown }[];
  checks: SessionCreateCheckInput[];
};

/** A flow whose `send` action dispatches `work` to `{ id, state }`, and whose create check admits only ids starting `ok_`. */
function bornFlow(kind: string, observed: Observed) {
  const work = handler({
    name: "work",
    inputSchema: z.object({ note: z.string() }),
    outputSchema: z.object({}),
    execute: async (input, ctx) => {
      observed.runs.push({ sessionId: ctx.session.identity.id, input, state: ctx.session.state });
      return {};
    }
  });

  const send = markDispatcher(
    handler({
      name: "send-work",
      inputSchema: z.object({ to: z.string(), owner: z.string().optional(), note: z.string() }),
      outputSchema: z.unknown(),
      execute: async (input, ctx) =>
        dispatchThroughSeam(ctx, {
          type: "internal",
          action: "work",
          session: input.owner === undefined ? { id: input.to } : { id: input.to, state: { owner: input.owner } },
          payload: { note: input.note },
          from: "send-work"
        })
    }),
    { type: "internal", action: "work" }
  );

  return defineFlow({
    kind,
    session: {
      stateSchema: z.object({ owner: z.string().readonly().optional(), seen: z.number().default(0) }),
      createCheck: async (input) => {
        // The senders' own sessions are born on the action path.
        if (input.via !== "dispatch") return { ok: true };
        observed.checks.push(input);
        return input.sessionId.startsWith("ok_") ? { ok: true } : { ok: false, status: 403, message: "not yours" };
      }
    },
    actions: { send: { block: send } },
    internal: { actions: { work: { block: work } } }
  })({ id: kind });
}

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function boot(kind: string) {
  const observed: Observed = { runs: [], checks: [] };
  const flow = bornFlow(kind, observed);
  const state = createFlowState({ flows: { [kind]: flow }, stores: { default: { primary: inMemoryStores() } } });
  const runtime = await state.getRuntime();
  return { observed, flow, runtime, state };
}

/**
 * Make the next create-if-absent write at `id` lose: a racing creator's
 * record lands between the birth's read and its write.
 */
function loseTheCreate(runtime: FlowStateRuntime, id: string, winner: Record<string, unknown>): void {
  const sessions = runtime.stores.session;
  const set = sessions.set.bind(sessions);
  sessions.set = async (key, value, expected) => {
    if (key === id && expected === "absent") {
      sessions.set = set;
      const ts = Date.now();
      await set(key, { id: key, version: 0, createdAt: ts, updatedAt: ts, journal: [], lineageId: "lin_winner", ...winner } as never, "absent");
    }
    return set(key, value, expected);
  };
}

function send(runtime: FlowStateRuntime, flow: ReturnType<typeof bornFlow>, input: unknown, userId = USER_ID) {
  return runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "send",
    input,
    userId,
    sessionId: `s_sender_${userId}`,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  });
}

describe("an { id } dispatch target with starting state", () => {
  it("creates the absent session at that id, top-level, through the create check, and delivers into it", async () => {
    const { observed, flow, runtime, state } = await boot("id-born");
    try {
      const result = await send(runtime, flow, { to: "ok_alpha", owner: "alpha", note: "hello" });
      expect(result.error).toBeUndefined();
      expect(result.output).toMatchObject({ ok: true, sessionId: "ok_alpha", adopted: false });

      await until(() => observed.runs.length === 1, "the delivery to run");
      expect(observed.runs[0]).toMatchObject({ sessionId: "ok_alpha", input: { note: "hello" } });

      // Born from the state the block computed, parsed by the flow's schema.
      const record = await runtime.stores.session.get("ok_alpha");
      expect(record).toMatchObject({ flowKind: "id-born", userId: USER_ID, orgId: DEFAULT_ORG_ID, state: { owner: "alpha", seen: 0 } });
      // A session of its own, not a child of the sender's.
      expect(record?.parentSessionId ?? undefined).toBeUndefined();

      // Judged as a dispatch, for the sending principal.
      expect(observed.checks).toHaveLength(1);
      expect(observed.checks[0]).toMatchObject({ sessionId: "ok_alpha", via: "dispatch", principal: { userId: USER_ID } });
    } finally {
      await state.dispose();
    }
  });

  it("refuses by name when the create check refuses, and writes nothing", async () => {
    const { observed, flow, runtime, state } = await boot("id-refused");
    try {
      const result = await send(runtime, flow, { to: "theirs_1", owner: "alpha", note: "hello" });
      expect(result.error?.message ?? JSON.stringify(result.output)).toMatch(/create-refused/);
      expect(await runtime.stores.session.get("theirs_1")).toBeUndefined();
      expect(observed.runs).toHaveLength(0);
    } finally {
      await state.dispose();
    }
  });

  it("delivers into the session when it exists, keeping its own state and skipping the create check", async () => {
    const { observed, flow, runtime, state } = await boot("id-present");
    try {
      await send(runtime, flow, { to: "ok_beta", owner: "first", note: "one" });
      await until(() => observed.runs.length === 1, "the first delivery");
      const second = await send(runtime, flow, { to: "ok_beta", owner: "second", note: "two" });
      expect(second.output).toMatchObject({ ok: true, sessionId: "ok_beta", adopted: true });
      await until(() => observed.runs.length === 2, "the second delivery");
      expect(observed.checks).toHaveLength(1);
      expect((await runtime.stores.session.get("ok_beta"))?.state).toMatchObject({ owner: "first" });
    } finally {
      await state.dispose();
    }
  });

  it("still refuses another user's existing session at that id, as an absent one", async () => {
    const { observed, flow, runtime, state } = await boot("id-foreign");
    try {
      await send(runtime, flow, { to: "ok_gamma", owner: "bob", note: "bob's" }, "u_bob");
      await until(() => observed.runs.length === 1, "bob's delivery");
      const result = await send(runtime, flow, { to: "ok_gamma", owner: "alice", note: "alice's" });
      expect(result.error?.message ?? JSON.stringify(result.output)).toMatch(/session-not-found/);
      expect((await runtime.stores.session.get("ok_gamma"))?.userId).toBe("u_bob");
    } finally {
      await state.dispose();
    }
  });

  it("loses a create race to the same user's session: delivers into it, keeping the winner's state", async () => {
    const { observed, flow, runtime, state } = await boot("id-race-same");
    try {
      const winner = { flowKind: "id-race-same", flowId: "id-race-same", userId: USER_ID, orgId: DEFAULT_ORG_ID };
      loseTheCreate(runtime, "ok_race", { ...winner, state: { owner: "winner", seen: 0 } });
      const result = await send(runtime, flow, { to: "ok_race", owner: "loser", note: "hello" });
      expect(result.output).toMatchObject({ ok: true, sessionId: "ok_race", adopted: true });
      await until(() => observed.runs.length === 1, "the delivery into the winner");
      expect((await runtime.stores.session.get("ok_race"))?.state).toMatchObject({ owner: "winner" });
    } finally {
      await state.dispose();
    }
  });

  it("loses a create race to another user's session: refused as absent, and nothing runs there", async () => {
    const { observed, flow, runtime, state } = await boot("id-race-foreign");
    try {
      const winner = { flowKind: "id-race-foreign", flowId: "id-race-foreign", userId: "u_bob", orgId: DEFAULT_ORG_ID };
      loseTheCreate(runtime, "ok_taken", { ...winner, state: { owner: "bob", seen: 0 } });
      const result = await send(runtime, flow, { to: "ok_taken", owner: "alice", note: "hello" });
      expect(result.error?.message ?? JSON.stringify(result.output)).toMatch(/session-not-found/);
      expect((await runtime.stores.session.get("ok_taken"))?.userId).toBe("u_bob");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(observed.runs).toHaveLength(0);
    } finally {
      await state.dispose();
    }
  });

  it("without state, an absent id is still refused and never created", async () => {
    const { observed, flow, runtime, state } = await boot("id-plain");
    try {
      const result = await send(runtime, flow, { to: "ok_delta", note: "lost" });
      expect(result.error?.message ?? JSON.stringify(result.output)).toMatch(/session-not-found/);
      expect(await runtime.stores.session.get("ok_delta")).toBeUndefined();
      expect(observed.checks).toHaveLength(0);
    } finally {
      await state.dispose();
    }
  });
});
