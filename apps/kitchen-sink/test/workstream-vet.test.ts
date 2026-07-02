/**
 * workstream-vet unit tests (throwaway tracer bullet).
 *
 * Deterministic coverage of the vet's loop mechanics against a REAL
 * execution context + in-memory stores (`executeBlock` — the blocks.test
 * convention). The model is never involved: `doneWhen` / `replan` /
 * `seedStart` / `applyDecision` are handlers, and the drafter's persist tap
 * is exercised directly.
 *
 * Spec criteria covered here:
 *   - 4a (capability path): the rendered workspace context contains the
 *     human feedback the preset formats.
 *   - 4b (data path): the persist tap echoes `latestFeedback` into
 *     `feedbackEcho`.
 *   - approval gating: `seedStart` seeds the draft task ONLY; the first
 *     approval task appears only after the acceptance criterion passes.
 *   - goal judgment independent of approval: acceptance-unmet → replan with
 *     no human task involved.
 *   - human decision lands via `complete`, and reject → revise + fresh
 *     approval with a dep.
 *
 * The cross-request board round-trip (the seam itself) is proven by the
 * spec's three-process `fsdev run` script, not here — a single vitest
 * process can't prove process isolation.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";

// A stray FSDEV_DEFAULT_MODEL in the shell makes createExecutionContext's
// default resolver throw ("set, but no intents are declared"). No test here
// ever calls a REAL model — neutralize the override for this process.
delete process.env.FSDEV_DEFAULT_MODEL;
import { defineFlow, handler } from "@flow-state-dev/core";
import {
  createExecutionContext,
  createInMemoryStores,
  executeBlock,
} from "@flow-state-dev/engine";
import { formatWorkspaceContext } from "../flows/workstream-vet/capability";
import { drafterGenerator, persistDraft } from "../flows/workstream-vet/drafter";
import { boardCollection, hasClaimable } from "../flows/workstream-vet/board";
import {
  applyDecision,
  buildSnapshot,
  classifyBoard,
  doneWhen,
  replan,
  resolveTask,
  seedStart,
} from "../flows/workstream-vet/loop";
import {
  DRAFTER,
  HUMAN_APPROVER,
  HUMAN_REQUESTER,
  workspaceResource,
  workstreamTasksCollection,
  type WorkspaceState,
} from "../flows/workstream-vet/resources";

// Minimal host flow so the execution context registers the vet's resources.
function makeTestFlow() {
  const noop = handler({
    name: "noop",
    resources: {
      wsvetWorkspace: workspaceResource,
      wsvetTasks: workstreamTasksCollection,
    },
    execute: () => "ok",
  });
  return defineFlow({
    kind: "workstream-vet-test",
    actions: { run: { inputSchema: z.string(), block: noop } },
  })();
}

async function createCtx() {
  const stores = createInMemoryStores();
  const ctx = await createExecutionContext({
    flow: makeTestFlow(),
    actionName: "run",
    requestId: "req_1",
    sessionId: "sess_1",
    userId: "user_1",
    stores,
  });
  return ctx as any;
}

const ws = (ctx: any): { state: WorkspaceState } => ctx.resources.wsvetWorkspace;

describe("workstream-vet: capability context (criterion 4a)", () => {
  it("the capability preset carries the workspace feedback into the drafter's rendered call", async () => {
    // The load-bearing 4a proof: run the REAL drafter generator against a
    // mock model resolver and inspect what reached the model. `input.feedback`
    // is deliberately null, so the ONLY path for the feedback string into the
    // call is the capability's context preset (`uses: [workstreamWorkspaceCap]`).
    // This fails if the `uses` wiring is dropped or the preset stops rendering.
    const mock = mockGenerator({
      name: "wsvet-drafter-gen",
      script: [
        { when: () => true, then: { structuredOutput: { draft: "revised" } } },
      ],
    });
    const stores = createInMemoryStores();
    const ctx = (await createExecutionContext({
      flow: makeTestFlow(),
      actionName: "run",
      requestId: "req_cap",
      sessionId: "sess_cap",
      userId: "user_1",
      stores,
      modelResolver: createMockModelResolver({
        generators: { "wsvet-drafter-gen": mock },
        policy: "error",
      }),
    })) as any;

    await ctx.resources.wsvetWorkspace.updateState((s: WorkspaceState) => ({
      ...s,
      goal: "Brief ACME",
      draftsWritten: 1,
      latestFeedback: "Add pricing details.",
    }));

    const result = await executeBlock({
      block: drafterGenerator,
      input: { goal: "Brief ACME", feedback: null, requirements: null },
      ctx,
    });
    expect(result.error).toBeUndefined();
    expect(mock.calls.length).toBeGreaterThan(0);
    const rendered = JSON.stringify(mock.calls);
    expect(rendered).toContain("Add pricing details.");
  });

  it("renders the human feedback the preset formats", () => {
    const rendered = formatWorkspaceContext({
      goal: "Produce an approved brief on ACME",
      draft: "v1",
      draftsWritten: 2,
      latestFeedback: "Too long; cut to one page and add pricing.",
      feedbackEcho: null,
    });
    expect(rendered).not.toBeNull();
    expect(rendered!.workstreamWorkspace).toContain(
      "Too long; cut to one page and add pricing.",
    );
    expect(rendered!.workstreamWorkspace).toContain("Produce an approved brief");
  });

  it("suppresses the tag before start (goal unset)", () => {
    expect(
      formatWorkspaceContext({
        goal: null,
        draft: null,
        draftsWritten: 0,
        latestFeedback: null,
        feedbackEcho: null,
      }),
    ).toBeNull();
  });
});

describe("workstream-vet: seeding and approval gating", () => {
  it("seedStart seeds the draft task only — never an approval task", async () => {
    const ctx = await createCtx();
    await executeBlock({ block: seedStart, input: { goal: "Brief ACME" }, ctx });

    const c = await boardCollection(ctx);
    expect(c.count()).toBe(1);
    const [task] = c.list();
    expect(task!.assignee).toBe(DRAFTER);
    expect(task!.status).toBe("pending");
    expect(c.count({ assignee: HUMAN_APPROVER })).toBe(0);
    expect(ws(ctx).state.goal).toBe("Brief ACME");
  });

  it("seedStart is idempotent on a non-empty board", async () => {
    const ctx = await createCtx();
    await executeBlock({ block: seedStart, input: { goal: "Brief ACME" }, ctx });
    await executeBlock({ block: seedStart, input: { goal: "Other goal" }, ctx });
    const c = await boardCollection(ctx);
    expect(c.count()).toBe(1);
    expect(ws(ctx).state.goal).toBe("Brief ACME");
  });
});

describe("workstream-vet: goal judgment independent of approval", () => {
  it("acceptance-unmet → replan with no human involvement", async () => {
    const ctx = await createCtx();
    await executeBlock({ block: seedStart, input: { goal: "Brief ACME" }, ctx });
    // Emulate the drain: the draft task ran once (< MIN_DRAFTS).
    const c0 = await boardCollection(ctx);
    const draft = await c0.claim("w1");
    await c0.complete(draft!.id, { draft: "v1" });
    await ctx.resources.wsvetWorkspace.updateState((s: WorkspaceState) => ({
      ...s,
      draftsWritten: 1,
    }));

    const result = await executeBlock({ block: doneWhen, input: {}, ctx });
    expect(result.output).toMatchObject({ decision: "replan", reason: "acceptance" });

    await executeBlock({ block: replan, input: result.output, ctx });
    const c = await boardCollection(ctx);
    // A revise task for the drafter appeared; still zero human tasks.
    expect(c.count({ assignee: DRAFTER })).toBe(2);
    expect(c.count({ assignee: HUMAN_APPROVER })).toBe(0);
  });

  it("acceptance met with no approval yet → replan seeds the FIRST approval", async () => {
    const ctx = await createCtx();
    await executeBlock({ block: seedStart, input: { goal: "Brief ACME" }, ctx });
    const c0 = await boardCollection(ctx);
    const draft = await c0.claim("w1");
    await c0.complete(draft!.id, { draft: "v1" });
    await ctx.resources.wsvetWorkspace.updateState((s: WorkspaceState) => ({
      ...s,
      draftsWritten: 2,
    }));

    const result = await executeBlock({ block: doneWhen, input: {}, ctx });
    expect(result.output).toMatchObject({ decision: "replan", reason: "seed-approval" });

    await executeBlock({ block: replan, input: result.output, ctx });
    const c = await boardCollection(ctx);
    const approvals = c.list({ assignee: HUMAN_APPROVER });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.status).toBe("awaiting_review");

    // The open approval now classifies as blocked_on_human — and the board
    // has nothing claimable (the awaiting_review task is never eligible).
    const after = await executeBlock({ block: doneWhen, input: {}, ctx });
    expect(after.output).toMatchObject({ decision: "blocked_on_human" });
  });
});

describe("workstream-vet: the human decision", () => {
  async function ctxAtApprovalGate() {
    const ctx = await createCtx();
    await executeBlock({ block: seedStart, input: { goal: "Brief ACME" }, ctx });
    const c0 = await boardCollection(ctx);
    const draft = await c0.claim("w1");
    await c0.complete(draft!.id, { draft: "v1" });
    await ctx.resources.wsvetWorkspace.updateState((s: WorkspaceState) => ({
      ...s,
      draftsWritten: 2,
    }));
    const d = await executeBlock({ block: doneWhen, input: {}, ctx });
    await executeBlock({ block: replan, input: d.output, ctx });
    return ctx;
  }

  it("reject → feedback written to the workspace + revise task + fresh approval with dep", async () => {
    const ctx = await ctxAtApprovalGate();
    await executeBlock({
      block: applyDecision,
      input: { verdict: "reject", feedback: "Too long." },
      ctx,
    });

    const d = await executeBlock({ block: doneWhen, input: {}, ctx });
    expect(d.output).toMatchObject({
      decision: "replan",
      reason: "rejected",
      feedback: "Too long.",
    });

    await executeBlock({ block: replan, input: d.output, ctx });
    // The feedback landed on the SAME workspace field the preset renders.
    expect(ws(ctx).state.latestFeedback).toBe("Too long.");

    const c = await boardCollection(ctx);
    const approvals = c.list({ assignee: HUMAN_APPROVER, status: "awaiting_review" });
    expect(approvals).toHaveLength(1);
    // The fresh approval depends on the revise task — not claimable-visible
    // to blockedOnYou until the revise completes.
    expect(approvals[0]!.deps).toHaveLength(1);
    const snap = buildSnapshot(c, ws(ctx).state, { checkGoal: true });
    expect(snap.blockedOnYou).toHaveLength(0);
    expect(snap.workstreamStatus).toBe("in_progress");

    // The fresh approval's revise-dep hasn't completed — a premature decide
    // must NOT be able to land on it (it isn't the human's to act on yet).
    const premature = await executeBlock({
      block: applyDecision,
      input: { verdict: "approve", feedback: null },
      ctx,
    });
    expect(premature.error?.message ?? String(premature.error)).toContain(
      "no open approval task",
    );
  });

  it("approve → done", async () => {
    const ctx = await ctxAtApprovalGate();
    await executeBlock({
      block: applyDecision,
      input: { verdict: "approve", feedback: null },
      ctx,
    });
    const d = await executeBlock({ block: doneWhen, input: {}, ctx });
    expect(d.output).toMatchObject({ decision: "done" });
  });

  it("throws when nothing is blocked on the human", async () => {
    const ctx = await createCtx();
    const result = await executeBlock({
      block: applyDecision,
      input: { verdict: "approve", feedback: null },
      ctx,
    });
    expect(result.error?.message ?? String(result.error)).toContain(
      "no open approval task",
    );
  });
});

describe("workstream-vet: persist tap (criterion 4b)", () => {
  it("echoes latestFeedback into feedbackEcho and bumps the draft counter", async () => {
    const ctx = await createCtx();
    await ctx.resources.wsvetWorkspace.updateState((s: WorkspaceState) => ({
      ...s,
      goal: "Brief ACME",
      draftsWritten: 1,
      latestFeedback: "Too long.",
    }));

    await executeBlock({ block: persistDraft, input: { draft: "v2 draft" }, ctx });

    const state = ws(ctx).state;
    expect(state.draft).toBe("v2 draft");
    expect(state.draftsWritten).toBe(2);
    expect(state.feedbackEcho).toBe("Too long.");
  });
});

describe("workstream-vet: human WORK tasks (a whole task assigned to a human)", () => {
  it("a human work task gating the draft classifies blocked_on_human — never a spurious acceptance replan", async () => {
    const ctx = await createCtx();
    await executeBlock({
      block: seedStart,
      input: { goal: "Brief ACME", humanBriefFirst: true },
      ctx,
    });

    const c = await boardCollection(ctx);
    expect(c.count()).toBe(2);
    expect(c.count({ assignee: HUMAN_REQUESTER, status: "awaiting_review" })).toBe(1);
    // The draft is dep-gated on the human work task — nothing claimable.
    expect(hasClaimable(c)).toBe(false);

    // draftsWritten is 0 (< MIN_DRAFTS), but the classifier must NOT fire
    // the acceptance replan — the ball is in the human's court.
    const d = await executeBlock({ block: doneWhen, input: {}, ctx });
    expect(d.output).toMatchObject({ decision: "blocked_on_human" });
    const snap = buildSnapshot(c, ws(ctx).state, { checkGoal: true });
    expect(snap.blockedOnYou).toHaveLength(1);
    expect(snap.blockedOnYou[0]!.title).toBe("Requirements (human)");
  });

  it("resolve completes the work task with arbitrary output and unlocks the gated draft", async () => {
    const ctx = await createCtx();
    await executeBlock({
      block: seedStart,
      input: { goal: "Brief ACME", humanBriefFirst: true },
      ctx,
    });

    const result = await executeBlock({
      block: resolveTask,
      input: { taskId: null, output: { requirements: "Must include a pricing table." } },
      ctx,
    });
    expect(result.error).toBeUndefined();

    const c = await boardCollection(ctx);
    const brief = c.list({ assignee: HUMAN_REQUESTER })[0]!;
    expect(brief.status).toBe("completed");
    expect(brief.output).toMatchObject({
      requirements: "Must include a pricing table.",
    });
    // The human's output now gates nothing: the draft is claimable, and the
    // substrate will materialize the work-task output into the drafter's
    // input via deps.
    expect(hasClaimable(c)).toBe(true);
  });

  it("resolve refuses when nothing is actionable", async () => {
    const ctx = await createCtx();
    const result = await executeBlock({
      block: resolveTask,
      input: { taskId: null, output: {} },
      ctx,
    });
    expect(result.error?.message ?? String(result.error)).toContain(
      "no actionable human task",
    );
  });
});

describe("workstream-vet: board predicates and terminal states", () => {
  it("hasClaimable respects dependency gating", async () => {
    const ctx = await createCtx();
    const c = await boardCollection(ctx);
    const a = await c.addTask({ goal: "a", assignee: DRAFTER });
    await c.addTask({ goal: "b", assignee: DRAFTER, deps: [a.id] });
    expect(hasClaimable(c)).toBe(true); // `a` is claimable
    const claimed = await c.claim("w1");
    expect(claimed!.id).toBe(a.id);
    expect(hasClaimable(c)).toBe(false); // `b` gated on incomplete `a`
    await c.complete(a.id, { ok: true });
    expect(hasClaimable(c)).toBe(true); // `b` unlocked
  });

  it("an errored task classifies the workstream as errored, not stuck", async () => {
    const ctx = await createCtx();
    const c = await boardCollection(ctx);
    const t = await c.addTask({ goal: "will fail", assignee: DRAFTER });
    await c.claim("w1");
    await c.fail(t.id, "boom");
    const decision = classifyBoard(c, ws(ctx).state, { checkGoal: true });
    expect(decision.decision).toBe("errored");
  });
});
