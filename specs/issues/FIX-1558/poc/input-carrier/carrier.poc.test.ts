/**
 * FIX-1558 POC · the carrier for the cascade's original input.
 *
 * Claim: with only the public API, a cascade compiles as
 *   cascade   = sequencer(name).step(rootLevel)           a container
 *   rootLevel = sequencer .step(evaluator) .step(gate) .step(router)
 *   nested    = sequencer .step((env) => env.input, evaluator) .step(gate) .step(router)
 * The evaluator stays its own traced step. The gate handler reads its level's
 * input from `ctx.parent.input` (unwrapping `.input` below the root) and
 * returns `{ input, verdict }`. Leaves and `ambiguous` are
 * `block.connectInput((env) => env.input)`; a nested level takes the envelope.
 *
 * Checks: (1) a leaf two levels down receives the original action input;
 * (2) each evaluator is its own block_trace row; (3) a leaf that suspends and
 * resumes calls neither evaluator again and takes the same route; (4) the unit
 * harness (testBlock) on the cascade itself; (5) the cascade as an action's
 * own root block. Controls: (a) leaves without the unwrap connector get the
 * envelope; (b) the root level without the container, as an action's root
 * block, sees no input (`ctx.parent.input` is undefined for the block a run
 * starts at), which is why the container exists.
 *
 * Throwaway. Run on the FIX-1554 implementation branch (#2206): see README.
 */
import { choice, defineFlow, evaluator, handler, router, sequencer, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import { mockEvaluationModel, testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { continueRequest, createFlowRegistry, createInMemoryStores, createResponseEmitter, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";

type Verdict = { edge: string } | { ambiguous: string };
type Env = { input: unknown; verdict: Verdict };

function level(
  name: string,
  ask: BlockDefinition,
  on: string,
  branches: Record<string, BlockDefinition>,
  ambiguous: BlockDefinition,
  nested: boolean,
  unwrap = true,
) {
  // A level's own input is the cascade input at the root and the parent
  // level's envelope below it. `connectInput` on a sequencer is a first step,
  // so `ctx.parent.input` is the pre-connector value: unwrap explicitly.
  const own = (raw: any) => (nested ? raw.input : raw);
  const isLevel = (b: BlockDefinition) => (b as any).__level === true;
  const wrap = (b: BlockDefinition) => (unwrap && !isLevel(b) ? b.connectInput((env: Env) => env.input) : b);
  const routes = new Map(Object.entries(branches).map(([k, b]) => [k, wrap(b)]));
  const amb = wrap(ambiguous);
  const gate = handler({
    name: `${name}-gate`,
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: (out: any, ctx) => {
      const a = out.answers[on];
      const verdict: Verdict =
        a?.type !== "choice" || !routes.has(a.choice)
          ? { ambiguous: "no-branch" }
          : typeof a.confidence !== "number"
            ? { ambiguous: "no-confidence" }
            : { edge: a.choice };
      return { input: own(ctx.parent!.input), verdict };
    },
  });
  const pick = router({
    name: `${name}-route`,
    routes: [...routes.values(), amb],
    execute: (env: Env) => ("edge" in env.verdict ? routes.get(env.verdict.edge)! : amb),
  });
  const seq = nested
    ? sequencer({ name }).step((raw: any) => own(raw), ask).step(gate).step(pick)
    : sequencer({ name }).step(ask).step(gate).step(pick);
  return Object.assign(seq, { __level: true });
}

const ticket = { message: "I was charged twice", id: "T-1" };

function build(opts: { unwrap?: boolean; suspend?: boolean } = {}) {
  const seen: unknown[] = [];
  const runs = { leaf: 0 };
  const deptModel = mockEvaluationModel({ answers: { team: { type: "choice", choice: "billing", confidence: 0.9 } } });
  const urgModel = mockEvaluationModel({ answers: { urgency: { type: "choice", choice: "urgent", confidence: 0.8 } } });
  const dept = evaluator({
    name: "dept",
    model: deptModel,
    state: (i: any) => i.message,
    questions: { team: choice("Team?", { billing: "b", technical: "t" }) },
  });
  const urg = evaluator({
    name: "urg",
    model: urgModel,
    state: (i: any) => i.message,
    questions: { urgency: choice("Urgency?", { urgent: "u", routine: "r" }) },
  });
  const urgentBilling = handler({
    name: "urgent-billing",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (input, ctx) => {
      runs.leaf += 1;
      seen.push(input);
      if (runs.leaf === 1 && opts.suspend !== false) {
        return ctx.suspend!({ reason: "human_approval", message: "page on-call?" });
      }
      return { handled: input };
    },
  });
  const other = handler({ name: "other", inputSchema: z.any(), outputSchema: z.any(), execute: async (i) => ({ other: i }) });
  const review = handler({ name: "review", inputSchema: z.any(), outputSchema: z.any(), execute: async (i) => ({ review: i }) });
  const inner = level("cascade/billing", urg, "urgency", { urgent: urgentBilling, routine: other }, review, true, opts.unwrap);
  const rootLevel = level("cascade/root", dept, "team", { billing: inner, technical: other }, review, false, opts.unwrap);
  // The cascade is a container around its root level, so the root level is
  // always a child with a recorded input: `ctx.parent.input` is undefined for
  // the block a run starts at (an action's root block, or testBlock's block).
  const root = sequencer({ name: "cascade" }).step(rootLevel);
  const flow = defineFlow({
    kind: `fix1558-carrier-${opts.unwrap === false ? "control" : "poc"}`,
    actions: { run: { block: sequencer({ name: "root", durable: true }).step(root), inputSchema: z.any() } },
  })();
  return { flow, root, rootLevel, seen, runs, deptModel, urgModel };
}

describe("FIX-1558 carrier POC", () => {
  it("a leaf two levels down gets the original input, evaluators are traced steps, resume does not re-ask", async () => {
    const { flow, seen, deptModel, urgModel } = build();
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({
      checkpoints: stores.checkpoints,
      suspensions: stores.suspensions,
      leases: stores.leases,
    });
    const response = createResponseEmitter({ requestId: "req_carrier", now: () => Date.now() });
    const initial = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: ticket,
      requestId: "req_carrier",
      userId: "u1",
      stores,
      responseEmitter: response,
      runtimeConfig: { durabilityProvider: provider },
    });
    expect(initial.error).toBeUndefined();
    expect((await stores.request.get("req_carrier"))?.status).toBe("suspended");
    expect(seen[0]).toEqual(ticket);

    const traces = response.getItems().filter((i) => i.type === "block_trace") as BlockTraceItem[];
    const evalRows = traces.filter((t) => t.blockKind === "evaluator").map((t) => t.blockName).sort();
    expect(evalRows).toEqual(["dept", "urg"]);
    expect(deptModel.calls).toHaveLength(1);
    expect(urgModel.calls).toHaveLength(1);

    const [suspension] = await provider.listSuspended({ status: "pending" });
    await provider.suspend({ ...suspension, status: "approved", resolvedAt: Date.now(), resumeData: { approved: true } });
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const { finished: pending } = await continueRequest({
      requestId: "req_carrier",
      stores,
      flowRegistry: registry,
      resumeContext: { suspensionId: suspension.suspensionId, action: "approve", data: { approved: true }, resumedBy: "r" },
      runtimeConfig: { durabilityProvider: provider },
    });
    const finished = await pending;
    expect(finished.error).toBeUndefined();
    expect(finished.output).toEqual({ handled: ticket });
    expect(seen[1]).toEqual(ticket);
    expect(deptModel.calls).toHaveLength(1);
    expect(urgModel.calls).toHaveLength(1);
  });

  it("control: without the unwrap connector the leaf gets the envelope, so the first check can fail", async () => {
    const { flow, seen } = build({ unwrap: false, suspend: false });
    const stores = createInMemoryStores();
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: ticket,
      requestId: "req_control",
      userId: "u1",
      stores,
      runtimeConfig: {},
    });
    expect(result.error).toBeUndefined();
    expect(seen[0]).not.toEqual(ticket);
    expect(seen[0]).toMatchObject({ verdict: { edge: "urgent" } });
  });

  it("the unit harness (testBlock) run on the cascade itself", async () => {
    const { root, seen } = build({ suspend: false });
    const result = await testBlock(root as any, { input: ticket } as any);
    expect(seen[0]).toEqual(ticket);
    expect(result.error).toBeNull();
  });

  it("the cascade as the action's own root block still sees its input", async () => {
    const { root, seen } = build({ suspend: false });
    const flow = defineFlow({ kind: "fix1558-carrier-rootblock", actions: { run: { block: root as any, inputSchema: z.any() } } })();
    const stores = createInMemoryStores();
    const result = await runAction({ orgId: DEFAULT_ORG_ID, flow, actionName: "run", input: ticket, requestId: "req_rootblock", userId: "u1", stores, runtimeConfig: {} });
    expect(result.error).toBeUndefined();
    expect(seen[0]).toEqual(ticket);
  });

  it("control: the root level run as the action's own block (no container) never sees its input", async () => {
    const { rootLevel, seen } = build({ suspend: false });
    const flow = defineFlow({ kind: "fix1558-carrier-nocontainer", actions: { run: { block: rootLevel as any, inputSchema: z.any() } } })();
    const stores = createInMemoryStores();
    const result = await runAction({ orgId: DEFAULT_ORG_ID, flow, actionName: "run", input: ticket, requestId: "req_nocontainer", userId: "u1", stores, runtimeConfig: {} });
    expect(result.error).toBeDefined();
    expect(seen).toHaveLength(0);
  });
});
