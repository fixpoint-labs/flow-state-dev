/**
 * THROWAWAY POC — compile-time half of `__poc-workstream-schema.test.ts`.
 *
 * Checked by `tsc`, NOT vitest (vitest transpiles without type-checking).
 * Core's own tsconfig only includes `src/**\/*`, so nothing in the repo
 * typechecks this by default — run it explicitly:
 *
 *   npx tsc --noEmit -p packages/core/test/__poc-tsconfig.json
 *
 * T1  Does a block's OWN `sessionStateSchema` type its `ctx.session.state`?
 * T2  Is another worker's key a type ERROR inside this worker? (Isolation.)
 * T3  Does `router({ routes: [A, B] })` over two DIFFERENT session schemas
 *     compile without the router declaring a union?
 * T4  Is a same-key/different-shape collision across routes a type error?
 * T5  The WorkstreamFlow shape: router input is `{ boardId, taskId }` while
 *     each route has its OWN input schema. Does `connectInput` bridge it?
 */
import { z } from "zod";
import { handler, router } from "../src/index";

const workerA = handler({
  name: "worker-a",
  inputSchema: z.object({ n: z.number() }),
  sessionStateSchema: z.object({ alpha: z.string() }),
  execute: async (_input, ctx) => {
    // T1 — own key, typed from this block's own declaration.
    const own: string = ctx.session.state.alpha;

    // T2 — worker B's key. If session typing is per-block, this is an error.
    // @ts-expect-error `beta` is not in worker-a's declared session schema
    const foreign = ctx.session.state.beta;

    return { own, foreign };
  },
});

const workerB = handler({
  name: "worker-b",
  inputSchema: z.object({ label: z.string() }), // NOTE: differs from A's input
  sessionStateSchema: z.object({ beta: z.number() }),
  execute: async (_input, ctx) => {
    const own: number = ctx.session.state.beta;
    return { own };
  },
});

// T3 — one router over both, using the `as any` escape on routes.
export const heterogeneousRouter = router({
  name: "workstream-router",
  inputSchema: z.object({ n: z.number(), assignee: z.string() }),
  routes: [workerA as any, workerB as any],
  execute: (input) => (input.assignee === "a" ? (workerA as any) : (workerB as any)),
});

// T4 — same key, incompatible shapes across two routes.
const workerC = handler({
  name: "worker-c",
  inputSchema: z.object({ n: z.number() }),
  sessionStateSchema: z.object({ shared: z.string() }),
  execute: async (_i, ctx) => ({ shared: ctx.session.state.shared }),
});

const workerD = handler({
  name: "worker-d",
  inputSchema: z.object({ n: z.number() }),
  sessionStateSchema: z.object({ shared: z.number() }),
  execute: async (_i, ctx) => ({ shared: ctx.session.state.shared }),
});

export const collisionRouter = router({
  name: "collision-router",
  inputSchema: z.object({ n: z.number(), pick: z.string() }),
  routes: [workerC as any, workerD as any],
  execute: (input) => (input.pick === "c" ? (workerC as any) : (workerD as any)),
});

// T5 — the real WorkstreamFlow shape, with NO casts anywhere.
//
// The flow action takes only the durable coordinate; each route has its own
// input schema. `routes: BlockDefinition<TInputSchema, ...>[]` requires every
// route to accept the ROUTER's input, and `connectInput` erases a route's
// input schema to `ZodTypeAny` — so it should be the bridge.
const workstreamInput = z.object({ boardId: z.string(), taskId: z.string() });

// Stand-in for "look the task up and build the assignee's payload".
const packA = (i: z.infer<typeof workstreamInput>) => ({ n: i.taskId.length });
const packB = (i: z.infer<typeof workstreamInput>) => ({ label: i.boardId });

export const workstreamRouter = router({
  name: "workstream-flow-router",
  inputSchema: workstreamInput,
  routes: [workerA.connectInput(packA), workerB.connectInput(packB)],
  execute: (input) =>
    input.taskId.startsWith("a") ? workerA.connectInput(packA) : workerB.connectInput(packB),
});
