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
 * T3  Can a router take two workers with different INPUT schemas directly?
 *     (Negative result, pinned with `@ts-expect-error` — no casts anywhere in
 *     this file, since a cast here would bypass the very types under test.)
 * T4  Is a same-key/different-shape SESSION collision a type error, once the
 *     input schemas are made compatible so nothing else can mask it?
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

// T3 — NEGATIVE RESULT, and no cast: the errors ARE the finding.
//
// `routes: BlockDefinition<TInputSchema, TOutputSchema>[]` requires every route
// to accept the ROUTER's input, so two workers whose input schemas differ
// cannot be routed directly. An earlier draft wrote `as any` here, which made
// the file green while proving nothing — the casts bypassed exactly the
// `routes`/`execute` types under test.
export const heterogeneousRouterNaive = router({
  name: "workstream-router-naive",
  inputSchema: z.object({ n: z.number(), assignee: z.string() }),
  // @ts-expect-error worker-b's input `{ label: string }` is not worker-a's `{ n: number }`
  routes: [workerA, workerB],
  // @ts-expect-error same mismatch; and TInputSchema is inferred from the routes
  // rather than from `inputSchema`, so `assignee` is not even visible here
  execute: (input) => (input.assignee === "a" ? workerA : workerB),
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

// Both share the router's input, so the route array is legal and the ONLY
// question left is the session-key collision. No cast. This compiles clean —
// `shared` is a string in one route and a number in the other, and tsc never
// says a word.
export const collisionRouter = router({
  name: "collision-router",
  inputSchema: z.object({ n: z.number() }),
  routes: [workerC, workerD],
  execute: (input) => (input.n > 0 ? workerC : workerD),
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
