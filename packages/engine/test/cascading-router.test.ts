/**
 * `utility.cascadingRouter` in the runtime: walking a two-level tree, what
 * every leaf and `ambiguous` receive, failures and cancellation, the trace a
 * reviewer reads, and resume after a leaf suspends.
 *
 * The input the author's leaves receive is the promise most likely to break
 * silently: an evaluator returns only its answers, so every leaf two levels
 * down depends on the cascade carrying the original input past both
 * evaluators. Each walking test deep-equals what a leaf got against what the
 * action was called with, in three placements (action root, nested in a
 * sequencer, and under `testBlock`), because the carrier behaves differently
 * at the root of a run.
 */
import {
  choice,
  defineFlow,
  evaluator,
  handler,
  sequencer,
  utility,
  DEFAULT_ORG_ID,
  type BlockDefinition
} from "@flow-state-dev/core";
import type { BlockTraceItem, OutputItem } from "@flow-state-dev/core/items";
import { buildItemLookup } from "@flow-state-dev/core/items";
import { resolveBlockValueInternal } from "@flow-state-dev/core/items/internal";
import { mockEvaluationModel, testBlock, type MockEvaluationAnswer } from "@flow-state-dev/testing";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { continueRequest, createFlowRegistry, createInMemoryStores, createResponseEmitter, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";

const ticket = { id: "T-1", message: "I was charged twice for one order" };

type TreeOptions = {
  department?: MockEvaluationAnswer | { error: Error } | { hold: true };
  urgency?: MockEvaluationAnswer;
  suspendEscalate?: boolean;
};

/** The SPEC's two-level tree, on scripted evaluation models that count their calls. */
function tree(options: TreeOptions = {}) {
  const dept = options.department ?? { type: "choice", choice: "billing", confidence: 0.9 };
  const departmentModel = mockEvaluationModel(
    "error" in dept ? { error: dept.error } : "hold" in dept ? { hold: true } : { answers: { team: dept } }
  );
  const urgencyModel = mockEvaluationModel({
    answers: { urgency: options.urgency ?? { type: "choice", choice: "high", confidence: 0.8 } },
  });
  const department = evaluator({
    name: "department",
    model: departmentModel,
    state: (input: typeof ticket) => input.message,
    questions: { team: choice("Which team?", { billing: "Payments", technical: "Bugs" }) },
  });
  const urgency = evaluator({
    name: "billing-urgency",
    model: urgencyModel,
    state: (input: typeof ticket) => input.message,
    questions: { urgency: choice("How urgent?", { high: "Now", low: "Later" }) },
  });

  const received: Record<string, unknown[]> = {};
  const leaf = (name: string, suspend = false) =>
    handler({
      name,
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (input, ctx) => {
        (received[name] ??= []).push(input);
        if (suspend && received[name]!.length === 1) {
          return ctx.suspend!({ reason: "human_approval", message: "page on-call?" });
        }
        return { handledBy: name, input };
      },
    });
  const escalate = leaf("escalate", options.suspendEscalate === true);
  const billingQueue = leaf("billing-queue");
  const techQueue = leaf("tech-queue");
  const review = leaf("review");

  const triage = utility.cascadingRouter({
    name: "triage",
    ambiguous: review,
    root: {
      ask: department,
      on: "team",
      branches: {
        billing: {
          minConfidence: 0.6,
          next: {
            ask: urgency,
            on: "urgency",
            branches: {
              high: { minConfidence: 0.7, block: escalate },
              low: { block: billingQueue },
            },
          },
        },
        technical: { minConfidence: 0.6, block: techQueue },
      },
    },
  });
  return { triage, received, departmentModel, urgencyModel };
}

async function runAsAction(block: BlockDefinition, requestId: string) {
  const flow = defineFlow({
    kind: `cascade-${requestId}`,
    actions: { run: { inputSchema: z.any(), block } },
  })();
  const stores = createInMemoryStores();
  const response = createResponseEmitter({ requestId, now: () => Date.now() });
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: ticket,
    requestId,
    userId: "user_1",
    stores,
    responseEmitter: response,
    runtimeConfig: {},
  });
  const items = response.getItems() as OutputItem[];
  return { result, items, stores };
}

/** The gate verdicts, in the order the levels ran, read from the trace. */
function verdicts(items: OutputItem[]) {
  const lookup = buildItemLookup(items);
  return (items as unknown as BlockTraceItem[])
    .filter((i) => i.type === "block_trace" && i.blockName.endsWith("/gate") && i.output !== undefined)
    .map((i) => (resolveBlockValueInternal(i.output!, lookup) as { verdict: unknown }).verdict);
}

describe("cascadingRouter · walking the tree", () => {
  it("a leaf two levels down receives the action's input and its output is the cascade's (BR-10, BR-11, BR-13)", async () => {
    const { triage, received, departmentModel, urgencyModel } = tree();
    const { result } = await runAsAction(triage, "req_walk_root");
    expect(result.error).toBeUndefined();
    expect(received.escalate).toEqual([ticket]);
    expect(result.output).toEqual({ handledBy: "escalate", input: ticket });
    // Level 2's evaluator asked about the ticket, not level 1's answer.
    expect(urgencyModel.calls.map((c) => c.state)).toEqual([ticket.message]);
    expect(departmentModel.calls).toHaveLength(1);
    expect(urgencyModel.calls).toHaveLength(1);
  });

  it("works nested inside a sequencer, not only as the action's root block", async () => {
    const { triage, received } = tree();
    const outer = sequencer({ name: "outer", inputSchema: z.any() }).step(triage);
    const { result } = await runAsAction(outer, "req_walk_nested");
    expect(result.error).toBeUndefined();
    expect(received.escalate).toEqual([ticket]);
  });

  it("works under testBlock", async () => {
    const { triage, received } = tree();
    const result = await testBlock(triage as never, { input: ticket } as never);
    expect(result.error).toBeNull();
    expect(received.escalate).toEqual([ticket]);
  });

  it("a level-1 leaf runs without asking level 2 (BR-13)", async () => {
    const { triage, received, urgencyModel } = tree({
      department: { type: "choice", choice: "technical", confidence: 0.95 },
    });
    const { result } = await runAsAction(triage, "req_walk_tech");
    expect(result.output).toEqual({ handledBy: "tech-queue", input: ticket });
    expect(received["tech-queue"]).toEqual([ticket]);
    expect(urgencyModel.calls).toHaveLength(0);
  });

  it("an edge with no floor opens on any reported confidence (BR-1)", async () => {
    const { triage, received } = tree({ urgency: { type: "choice", choice: "low", confidence: 0.1 } });
    await runAsAction(triage, "req_walk_nofloor");
    expect(received["billing-queue"]).toEqual([ticket]);
  });

  it("no confidence at level 2 lands on ambiguous with the action's input; no sibling runs (BR-4, BR-12)", async () => {
    const { triage, received } = tree({ urgency: { type: "choice", choice: "low" } });
    const { result, items } = await runAsAction(triage, "req_walk_noconf");
    expect(result.output).toEqual({ handledBy: "review", input: ticket });
    expect(received.review).toEqual([ticket]);
    expect(received["billing-queue"]).toBeUndefined();
    expect(received.escalate).toBeUndefined();
    expect(verdicts(items)).toEqual([
      { level: "root", on: "team", edge: "billing", confidence: 0.9 },
      { level: "root/billing", on: "urgency", ambiguous: "no-confidence", choice: "low" },
    ]);
  });

  it("below the floor at level 1 lands on ambiguous and never asks level 2 (BR-3, BR-12)", async () => {
    const { triage, received, urgencyModel } = tree({
      department: { type: "choice", choice: "billing", confidence: 0.5 },
    });
    const { result, items } = await runAsAction(triage, "req_walk_below");
    expect(result.output).toEqual({ handledBy: "review", input: ticket });
    expect(urgencyModel.calls).toHaveLength(0);
    expect(verdicts(items)).toEqual([{ level: "root", on: "team", ambiguous: "below-floor", choice: "billing" }]);
    expect(received.review).toEqual([ticket]);
  });

  it("a leaf under two edges builds and either edge reaches it (BR-14)", async () => {
    const departmentModel = mockEvaluationModel({ answers: { team: { type: "choice", choice: "technical", confidence: 1 } } });
    const department = evaluator({
      name: "department",
      model: departmentModel,
      questions: { team: choice("Which team?", { billing: "b", technical: "t" }) },
    });
    const seen: unknown[] = [];
    const shared = handler({ name: "shared", inputSchema: z.any(), outputSchema: z.any(), execute: (i) => { seen.push(i); return { shared: true }; } });
    const cascade = utility.cascadingRouter({
      name: "twice",
      ambiguous: shared,
      root: { ask: department, on: "team", branches: { billing: { block: shared }, technical: { block: shared } } },
    });
    const { result } = await runAsAction(cascade, "req_walk_shared");
    expect(result.error).toBeUndefined();
    expect(seen).toEqual([ticket]);
  });

  it("a leaf or ambiguous with its own connectInput gets the cascade input through that connector", async () => {
    // An author who adapts a block's input before routing to it must keep that
    // adapter: the cascade unwraps its envelope first, then the block's own
    // connector runs. Replacing it would hand the block the raw ticket.
    const departmentModel = mockEvaluationModel({ answers: { team: { type: "choice", choice: "technical", confidence: 1 } } });
    const department = evaluator({
      name: "department",
      model: departmentModel,
      questions: { team: choice("Which team?", { billing: "b", technical: "t" }) },
    });
    const seen: Record<string, unknown[]> = {};
    const caseOf = (name: string) =>
      handler({
        name,
        inputSchema: z.object({ caseId: z.string() }),
        outputSchema: z.any(),
        execute: (input) => {
          (seen[name] ??= []).push(input);
          return { name, caseId: input.caseId };
        },
      }).connectInput((t: typeof ticket) => ({ caseId: t.id }));
    const cascade = utility.cascadingRouter({
      name: "adapted",
      ambiguous: caseOf("review"),
      root: { ask: department, on: "team", branches: { technical: { minConfidence: 0.5, block: caseOf("tech") } } },
    });
    const { result } = await runAsAction(cascade, "req_walk_adapted");
    expect(result.error).toBeUndefined();
    expect(seen.tech).toEqual([{ caseId: "T-1" }]);

    const low = mockEvaluationModel({ answers: { team: { type: "choice", choice: "technical" } } });
    const again = utility.cascadingRouter({
      name: "adapted-ambiguous",
      ambiguous: caseOf("review"),
      root: {
        ask: evaluator({ name: "department", model: low, questions: { team: choice("Which team?", { billing: "b", technical: "t" }) } }),
        on: "team",
        branches: { technical: { block: caseOf("tech") } },
      },
    });
    const second = await runAsAction(again, "req_walk_adapted_ambiguous");
    expect(second.result.error).toBeUndefined();
    expect(seen.review).toEqual([{ caseId: "T-1" }]);
  });

  it("a level reused under two branches reports the path it was reached by", async () => {
    // Verdicts name the level so a reviewer can see where a case went to
    // review. A level object shared by two branches must name each placement.
    const departmentModel = mockEvaluationModel({ answers: { team: { type: "choice", choice: "technical", confidence: 1 } } });
    const urgencyModel = mockEvaluationModel({ answers: { urgency: { type: "choice", choice: "high" } } });
    const department = evaluator({
      name: "department",
      model: departmentModel,
      questions: { team: choice("Which team?", { billing: "b", technical: "t" }) },
    });
    const urgency = evaluator({
      name: "urgency",
      model: urgencyModel,
      questions: { urgency: choice("How urgent?", { high: "h", low: "l" }) },
    });
    const done = handler({ name: "done", inputSchema: z.any(), outputSchema: z.any(), execute: () => ({ done: true }) });
    const review = handler({ name: "review", inputSchema: z.any(), outputSchema: z.any(), execute: () => ({ review: true }) });
    const shared = { ask: urgency, on: "urgency", branches: { high: { block: done } } } as const;
    const cascade = utility.cascadingRouter({
      name: "reused",
      ambiguous: review,
      root: { ask: department, on: "team", branches: { billing: { next: shared }, technical: { next: shared } } },
    });
    const { result, items } = await runAsAction(cascade, "req_walk_reused");
    expect(result.error).toBeUndefined();
    expect(verdicts(items)).toEqual([
      { level: "root", on: "team", edge: "technical", confidence: 1 },
      { level: "root/technical", on: "urgency", ambiguous: "no-confidence", choice: "high" },
    ]);
    const levelRows = (items as unknown as BlockTraceItem[]).filter(
      (i) => i.type === "block_trace" && i.blockKind === "sequencer" && i.blockName.startsWith("reused/")
    );
    expect(levelRows.map((r) => r.blockName)).toEqual(["reused/root", "reused/root/technical"]);
  });
});

describe("cascadingRouter · failures", () => {
  it("a failed evaluation fails the cascade with the model's error, not ambiguous (BR-15)", async () => {
    const { triage, received } = tree({ department: { error: new Error("provider down: 503") } });
    const { result } = await runAsAction(triage, "req_fail");
    expect(result.error?.message).toMatch(/provider down: 503/);
    expect(received.review).toBeUndefined();
  });

  it("a rescue around the cascade runs for that error (BR-16)", async () => {
    const { triage, received } = tree({ department: { error: new Error("provider down: 503") } });
    const toReview = handler({ name: "rescued-review", execute: () => ({ rescued: true }) });
    const outer = sequencer({ name: "outer", inputSchema: z.any() }).step(triage).rescue([{ block: toReview }]);
    const { result } = await runAsAction(outer, "req_rescue");
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ rescued: true });
    expect(received.review).toBeUndefined();
  });

  it("a request cancelled mid-level ends cancelled, not failed and not ambiguous (BR-17)", async () => {
    const { triage, received, departmentModel } = tree({ department: { hold: true } });
    const controller = new AbortController();
    const stores = createInMemoryStores();
    const flow = defineFlow({ kind: "cascade-cancel", actions: { run: { inputSchema: z.any(), block: triage } } })();
    const running = runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: ticket,
      requestId: "req_cancel",
      userId: "user_1",
      signal: controller.signal,
      stores,
      runtimeConfig: {},
    });
    await vi.waitFor(() => expect(departmentModel.calls).toHaveLength(1));
    await stores.request.setFieldsIfStatus("req_cancel", { abortRequested: true }, ["in_progress"], Date.now());
    controller.abort();
    const result = await running;
    expect(result.error).toBeUndefined();
    expect((await stores.request.get("req_cancel"))?.status).toBe("aborted");
    expect(received.review).toBeUndefined();
  });
});

describe("cascadingRouter · trace and resume", () => {
  it("an ambiguous landing shows the evaluator row with no confidence and the verdict with its level (BR-4, BR-25, BR-27)", async () => {
    const { triage } = tree({ department: { type: "choice", choice: "billing" } });
    const { items } = await runAsAction(triage, "req_trace");
    const traces = (items as unknown as BlockTraceItem[]).filter((i) => i.type === "block_trace");
    const evaluatorRows = traces.filter((t) => t.blockKind === "evaluator");
    expect(evaluatorRows.map((t) => t.blockName)).toEqual(["department"]);
    const lookup = buildItemLookup(items);
    const answer = (resolveBlockValueInternal(evaluatorRows[0]!.output!, lookup) as { answers: { team: object } }).answers.team;
    expect(answer).toEqual({ type: "choice", choice: "billing" });
    expect(verdicts(items)).toEqual([{ level: "root", on: "team", ambiguous: "no-confidence", choice: "billing" }]);
    // Ordinary kinds only.
    expect(new Set(traces.map((t) => t.blockKind))).toEqual(new Set(["sequencer", "evaluator", "handler", "router"]));
  });

  it("a leaf that suspends resumes without asking either evaluator again, on the same route (BR-26)", async () => {
    const { triage, received, departmentModel, urgencyModel } = tree({ suspendEscalate: true });
    const flow = defineFlow({
      kind: "cascade-resume",
      actions: { run: { inputSchema: z.any(), block: sequencer({ name: "root", durable: true, inputSchema: z.any() }).step(triage) } },
    })();
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({
      checkpoints: stores.checkpoints,
      suspensions: stores.suspensions,
      leases: stores.leases,
    });
    const initial = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: ticket,
      requestId: "req_resume",
      userId: "user_1",
      stores,
      runtimeConfig: { durabilityProvider: provider },
    });
    expect(initial.error).toBeUndefined();
    expect((await stores.request.get("req_resume"))?.status).toBe("suspended");

    const [suspension] = await provider.listSuspended({ status: "pending" });
    await provider.suspend({ ...suspension!, status: "approved", resolvedAt: Date.now(), resumeData: { approved: true } });
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const { finished } = await continueRequest({
      requestId: "req_resume",
      stores,
      flowRegistry: registry,
      resumeContext: { suspensionId: suspension!.suspensionId, action: "approve", data: { approved: true }, resumedBy: "reviewer" },
      runtimeConfig: { durabilityProvider: provider },
    });
    const done = await finished;
    expect(done.error).toBeUndefined();
    expect(done.output).toEqual({ handledBy: "escalate", input: ticket });
    expect(received.escalate).toEqual([ticket, ticket]);
    expect(departmentModel.calls).toHaveLength(1);
    expect(urgencyModel.calls).toHaveLength(1);
  });
});
