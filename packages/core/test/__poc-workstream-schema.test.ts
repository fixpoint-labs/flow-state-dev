/**
 * THROWAWAY POC — not a shipping test.
 *
 * Question (from the epic design conversation): is there a seam that lets ONE
 * static WorkstreamFlow be typed per the block assigned to the task, or does a
 * single flow force a static union of every worker's session schema?
 *
 * S1  Does a worker's OWN `sessionStateSchema` type its `ctx.session`, with no
 *     flow-level declaration? (If yes, per-block typing is already the seam.)
 * S2  Can a router over two workers with DIFFERENT session schemas be DECLARED
 *     and RUN without the router itself declaring the union?
 * S3  At runtime, does each routed worker read/write only its own key when the
 *     session bag carries every worker's keys at once?
 * S4  Key collision — same key, different shape, across two routes. Caught at
 *     declaration, caught at runtime, or silent?
 *
 * The type-level half lives in `__poc-workstream-schema.test-d.ts` and is
 * checked by `tsc`, not by vitest (vitest transpiles without type-checking).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler, router } from "../src/index";
import { createMockContext, runForTest } from "./helpers";
import type { BlockContext } from "../src/types/block";

// ─── a ctx whose session state is a live bag we can inspect after the run ────

function makeCtx(sessionState: Record<string, unknown>): BlockContext {
  const state: Record<string, unknown> = { ...sessionState };
  return createMockContext({
    session: {
      identity: { type: "session", id: "sess_1" },
      state,
      patchState: async (u: Record<string, unknown>) => {
        Object.assign(state, u);
      },
      setState: async (n: Record<string, unknown>) => {
        for (const k of Object.keys(state)) delete state[k];
        Object.assign(state, n);
      },
      incState: async () => undefined,
      pushState: async () => undefined,
      setStateRecord: async () => undefined,
      deleteStateRecord: async () => undefined,
      atomicState: async () => undefined,
    } as any,
  });
}

const bagOf = (ctx: BlockContext) => (ctx as any).session.state as Record<string, unknown>;

// ─── S1 — two workers, each declaring its OWN session schema ─────────────────

const workerA = handler({
  name: "worker-a",
  inputSchema: z.object({ n: z.number() }),
  sessionStateSchema: z.object({ alpha: z.string() }),
  execute: async (input, ctx) => {
    // Own key, read off the block's own declared session schema.
    const seen = ctx.session.state.alpha;
    await ctx.session.patchState({ alpha: `A:${input.n}` });
    return { who: "A", seen };
  },
});

const workerB = handler({
  name: "worker-b",
  inputSchema: z.object({ n: z.number() }),
  sessionStateSchema: z.object({ beta: z.number() }),
  execute: async (input, ctx) => {
    const seen = ctx.session.state.beta;
    await ctx.session.patchState({ beta: input.n });
    return { who: "B", seen };
  },
});

// S4 — same key `shared`, different shapes.
const workerC = handler({
  name: "worker-c",
  inputSchema: z.object({ n: z.number() }),
  sessionStateSchema: z.object({ shared: z.string() }),
  execute: async (_i, ctx) => ({ who: "C", shared: ctx.session.state.shared }),
});

const workerD = handler({
  name: "worker-d",
  inputSchema: z.object({ n: z.number() }),
  sessionStateSchema: z.object({ shared: z.number() }),
  execute: async (_i, ctx) => ({ who: "D", shared: ctx.session.state.shared }),
});

describe("S1/S3 — per-worker session typing and runtime views", () => {
  it("each worker reads and writes through its own declared key", async () => {
    const ctxA = makeCtx({ alpha: "seedA" });
    const ctxB = makeCtx({ beta: 41 });

    const rA = await runForTest(workerA as any, { n: 1 }, ctxA);
    const rB = await runForTest(workerB as any, { n: 42 }, ctxB);

    console.log(
      `[s1] A saw=${(rA as any).seen} wrote=${bagOf(ctxA).alpha} · ` +
        `B saw=${(rB as any).seen} wrote=${bagOf(ctxB).beta}`,
    );
    expect((rA as any).seen).toBe("seedA");
    expect(bagOf(ctxA).alpha).toBe("A:1");
    expect((rB as any).seen).toBe(41);
    expect(bagOf(ctxB).beta).toBe(42);
  });

  it("a worker touches only its own key when the bag carries the union", async () => {
    // The WorkstreamFlow's session bag would carry the union at runtime if a
    // single durable session were shared across assignees.
    const shared = makeCtx({ alpha: "seedA", beta: 7 });
    const rA = await runForTest(workerA as any, { n: 2 }, shared);

    console.log(
      `[s3] bag keys after A ran=${Object.keys(bagOf(shared)).sort().join(",")} · ` +
        `A.seen=${(rA as any).seen}`,
    );
    expect(bagOf(shared).alpha).toBe("A:2");
    expect(bagOf(shared).beta).toBe(7); // untouched
  });
});

// ─── S2 — one router over both, WITHOUT declaring a union ────────────────────

describe("S2 — router over heterogeneous workers", () => {
  it("declares and runs without the router naming any session key", async () => {
    const workstreamRouter = router({
      name: "workstream-router",
      inputSchema: z.object({ n: z.number(), assignee: z.string() }),
      routes: [workerA as any, workerB as any],
      // Stands in for: look the task up by {boardId, taskId} and pick its block.
      execute: (input: any) => (input.assignee === "a" ? (workerA as any) : (workerB as any)),
    });

    // Does the router surface a merged session schema of its own?
    const declaredSessionSchema = (workstreamRouter as any).config?.sessionStateSchema;

    const ctx = makeCtx({ alpha: "seedA", beta: 5 });
    const viaA = await runForTest(workstreamRouter as any, { n: 9, assignee: "a" }, ctx);
    const viaB = await runForTest(workstreamRouter as any, { n: 8, assignee: "b" }, ctx);

    console.log(
      `[s2] router->A who=${(viaA as any).who} · router->B who=${(viaB as any).who} · ` +
        `router declares sessionStateSchema=${declaredSessionSchema === undefined ? "NO" : "YES"} · ` +
        `bag=${JSON.stringify(bagOf(ctx))}`,
    );
    expect((viaA as any).who).toBe("A");
    expect((viaB as any).who).toBe("B");
    // Both branches wrote through their own key into ONE bag.
    expect(bagOf(ctx).alpha).toBe("A:9");
    expect(bagOf(ctx).beta).toBe(8);
  });
});

// ─── S5 — the real WorkstreamFlow shape, no casts ────────────────────────────

describe("S5 — router input is the task coordinate, routes carry their own input", () => {
  it("connectInput bridges heterogeneous route inputs; each worker gets its payload", async () => {
    // Worker inputs DIFFER from the router's input and from each other.
    const wA = handler({
      name: "ws-a",
      inputSchema: z.object({ n: z.number() }),
      sessionStateSchema: z.object({ alpha: z.string() }),
      execute: async (input, ctx) => {
        await ctx.session.patchState({ alpha: `A:${input.n}` });
        return { who: "A", got: input.n };
      },
    });
    const wB = handler({
      name: "ws-b",
      inputSchema: z.object({ label: z.string() }),
      sessionStateSchema: z.object({ beta: z.number() }),
      execute: async (input, ctx) => {
        await ctx.session.patchState({ beta: input.label.length });
        return { who: "B", got: input.label };
      },
    });

    const packA = (i: { boardId: string; taskId: string }) => ({ n: i.taskId.length });
    const packB = (i: { boardId: string; taskId: string }) => ({ label: i.boardId });

    const wsRouter = router({
      name: "ws-router",
      inputSchema: z.object({ boardId: z.string(), taskId: z.string() }),
      routes: [wA.connectInput(packA), wB.connectInput(packB)],
      execute: (input) =>
        input.taskId.startsWith("a") ? wA.connectInput(packA) : wB.connectInput(packB),
    });

    const ctx = makeCtx({ alpha: "seed", beta: 0 });
    const toA = await runForTest(wsRouter as any, { boardId: "board-1", taskId: "a-77" }, ctx);
    const toB = await runForTest(wsRouter as any, { boardId: "board-1", taskId: "b-9" }, ctx);

    console.log(
      `[s5] ->A who=${(toA as any).who} got=${JSON.stringify((toA as any).got)} · ` +
        `->B who=${(toB as any).who} got=${JSON.stringify((toB as any).got)} · ` +
        `bag=${JSON.stringify(bagOf(ctx))}`,
    );
    expect((toA as any).who).toBe("A");
    expect((toA as any).got).toBe(4); // "a-77".length — packA ran
    expect((toB as any).who).toBe("B");
    expect((toB as any).got).toBe("board-1"); // packB ran
    // Each worker wrote through its OWN session key, in one shared bag.
    expect(bagOf(ctx).alpha).toBe("A:4");
    expect(bagOf(ctx).beta).toBe(7);
  });
});

// ─── S4 — key collision across routes ────────────────────────────────────────

describe("S4 — same key, different shape", () => {
  it("measures whether a collision is caught at declaration or at runtime", async () => {
    let declared = "ok";
    try {
      router({
        name: "collision-router",
        inputSchema: z.object({ n: z.number(), pick: z.string() }),
        routes: [workerC as any, workerD as any],
        execute: (input: any) => (input.pick === "c" ? (workerC as any) : (workerD as any)),
      });
    } catch (err) {
      declared = `THREW: ${(err as Error).message.slice(0, 80)}`;
    }

    // And at runtime, with a bag holding the WRONG shape for the picked route.
    const ctx = makeCtx({ shared: "a-string" });
    const asD = await runForTest(workerD as any, { n: 1 }, ctx);

    console.log(
      `[s4] router declaration=${declared} · ` +
        `workerD (declares shared:number) read ${JSON.stringify((asD as any).shared)} ` +
        `typeof=${typeof (asD as any).shared}`,
    );
    expect(declared).toBe("ok");
  });
});
