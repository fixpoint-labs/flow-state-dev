/**
 * workstream-vet — the hand-rolled workstream loop.
 *
 * One advance loop, re-entered by every MUTATING action (`start`, `decide`,
 * `advance`); `status` is a pure snapshot read that never drains the board:
 *
 *   drain (board) → doneWhen → replan (when asked) → loopBack → snapshot
 *
 * `doneWhen` evaluates in the spec's order: (1) terminal task failures,
 * (2) the deterministic acceptance check — goal judgment independent of any
 * human, (3) the approval round-trip. `replan` is keyed to which branch
 * fired. HITL here is pure board semantics: no durable-checkpoint machinery
 * anywhere in this flow — the request simply ends while the board stays
 * open (success criterion 3).
 */
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import type { Task, TaskCollectionRef } from "@flow-state-dev/tasks";
import { board, boardCollection } from "./board";
import {
  DRAFTER,
  HUMAN_APPROVER,
  MIN_DRAFTS,
  workspaceResource,
  workstreamTasksCollection,
  type WorkspaceState,
} from "./resources";

// ---------------------------------------------------------------------------
// Classification (shared by doneWhen and the snapshots)
// ---------------------------------------------------------------------------

export const decisionSchema = z.object({
  decision: z.enum([
    "errored",
    "replan",
    "blocked_on_human",
    "done",
    "in_progress",
  ]),
  reason: z.enum(["acceptance", "seed-approval", "rejected"]).nullable(),
  feedback: z.string().nullable(),
});
export type WorkstreamDecision = z.infer<typeof decisionSchema>;

const taskTime = (t: Task): number =>
  typeof t.createdAt === "number" ? t.createdAt : Date.parse(String(t.createdAt));

/** Newest approval task, or undefined before the first one is seeded. */
function newestApproval(c: TaskCollectionRef): Task | undefined {
  const approvals = c
    .list({ assignee: HUMAN_APPROVER })
    .sort((a, b) => taskTime(a) - taskTime(b));
  return approvals[approvals.length - 1];
}

/**
 * Pure board classification. `checkGoal: false` is the control mode
 * (`startUnchecked`): no acceptance criterion, no approval — drained = done,
 * i.e. planAndExecute-shaped.
 */
export function classifyBoard(
  c: TaskCollectionRef,
  ws: WorkspaceState,
  opts: { checkGoal: boolean },
): WorkstreamDecision {
  // (1) Terminal failures first: the wait/shouldExit drain also exits when a
  // task errored and nothing is claimable — without this branch a dead run
  // would read as merely stuck.
  if (c.count({ status: "errored" }) > 0 || c.count({ status: "cancelled" }) > 0) {
    return { decision: "errored", reason: null, feedback: null };
  }

  if (!opts.checkGoal) {
    const open = c.count({
      status: ["pending", "in_progress", "awaiting_review", "blocked"],
    });
    return open === 0
      ? { decision: "done", reason: null, feedback: null }
      : { decision: "in_progress", reason: null, feedback: null };
  }

  // (2) Deterministic acceptance check — independent of any human.
  if ((ws.draftsWritten ?? 0) < MIN_DRAFTS) {
    return { decision: "replan", reason: "acceptance", feedback: null };
  }

  // (3) The approval round-trip.
  const approval = newestApproval(c);
  if (approval === undefined) {
    return { decision: "replan", reason: "seed-approval", feedback: null };
  }
  if (approval.status === "completed") {
    const out = approval.output as
      | { verdict?: string; feedback?: string | null }
      | undefined;
    if (out?.verdict === "approve") {
      return { decision: "done", reason: null, feedback: null };
    }
    return { decision: "replan", reason: "rejected", feedback: out?.feedback ?? null };
  }
  if (approval.status === "awaiting_review") {
    // Only "blocked on you" when the human can actually act: an approval
    // whose dep (the revise task) hasn't completed yet is still in-flight
    // work, not a human gate. Without this check, a `status` read mid-cycle
    // would report blocked_on_human with an empty blockedOnYou list.
    const completed = new Set(c.list({ status: "completed" }).map((t) => t.id));
    const actionable = (approval.deps ?? []).every((dep) => completed.has(dep));
    return actionable
      ? { decision: "blocked_on_human", reason: null, feedback: null }
      : { decision: "in_progress", reason: null, feedback: null };
  }
  return { decision: "in_progress", reason: null, feedback: null };
}

// ---------------------------------------------------------------------------
// Loop blocks
// ---------------------------------------------------------------------------

const loopResources = {
  wsvetWorkspace: workspaceResource,
  wsvetTasks: workstreamTasksCollection,
};

export const doneWhen = handler({
  name: "wsvet-done-when",
  inputSchema: z.unknown(),
  outputSchema: decisionSchema,
  resources: loopResources,
  execute: async (_input, ctx: any) => {
    const c = await boardCollection(ctx);
    return classifyBoard(c, ctx.resources.wsvetWorkspace.state, { checkGoal: true });
  },
});

/**
 * Seed follow-up work, keyed to which doneWhen branch fired. On `rejected`
 * this also writes the human feedback into the workspace field the
 * capability preset renders and the persist tap echoes.
 */
export const replan = handler({
  name: "wsvet-replan",
  inputSchema: decisionSchema,
  resources: loopResources,
  execute: async (input, ctx: any) => {
    const c = await boardCollection(ctx);
    const ws = ctx.resources.wsvetWorkspace;
    const goal: string = ws.state.goal ?? "";

    if (input.reason === "acceptance") {
      await c.addTask({
        goal: `Revise the draft toward: ${goal}`,
        title: "Revise draft",
        context: "The acceptance criterion is not met yet; produce a revised draft.",
        assignee: DRAFTER,
        input: { feedback: null },
      });
      return;
    }

    if (input.reason === "seed-approval") {
      // The FIRST approval task is seeded here — never by `start` — so a
      // human can never approve an artifact the goal check hasn't accepted.
      await c.addTask({
        goal: "Review the current draft and approve or reject it.",
        title: "Human approval",
        assignee: HUMAN_APPROVER,
        status: "awaiting_review",
      });
      return;
    }

    if (input.reason === "rejected") {
      await ws.updateState((s: WorkspaceState) => ({
        ...s,
        latestFeedback: input.feedback,
      }));
      const revise = await c.addTask({
        goal: "Revise the draft to address the reviewer's feedback.",
        title: "Revise draft",
        assignee: DRAFTER,
        input: { feedback: input.feedback },
      });
      await c.addTask({
        goal: "Review the revised draft and approve or reject it.",
        title: "Human approval",
        assignee: HUMAN_APPROVER,
        status: "awaiting_review",
        deps: [revise.id],
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Snapshot (what every request returns)
// ---------------------------------------------------------------------------

export const snapshotSchema = z.object({
  workstreamStatus: z.enum(["done", "blocked_on_human", "in_progress", "errored"]),
  goal: z.string().nullable(),
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      assignee: z.string().nullable(),
      attempts: z.number(),
    }),
  ),
  blockedOnYou: z.array(
    z.object({ id: z.string(), title: z.string(), feedbackWanted: z.boolean() }),
  ),
  artifacts: z.object({
    draft: z.string().nullable(),
    revisions: z.number(),
    feedbackEcho: z.string().nullable(),
  }),
});
export type WorkstreamSnapshot = z.infer<typeof snapshotSchema>;

export function buildSnapshot(
  c: TaskCollectionRef,
  ws: WorkspaceState,
  opts: { checkGoal: boolean },
): WorkstreamSnapshot {
  const d = classifyBoard(c, ws, opts);
  const status =
    d.decision === "replan" || d.decision === "in_progress"
      ? "in_progress"
      : d.decision;

  const completed = new Set(c.list({ status: "completed" }).map((t) => t.id));
  const blockedOnYou = c
    .list({ status: "awaiting_review", assignee: HUMAN_APPROVER })
    .filter((t) => (t.deps ?? []).every((dep) => completed.has(dep)))
    .map((t) => ({ id: t.id, title: t.title ?? t.goal, feedbackWanted: true }));

  return {
    workstreamStatus: status,
    goal: ws.goal ?? null,
    tasks: c.list().map((t) => ({
      id: t.id,
      title: t.title ?? t.goal,
      status: t.status,
      assignee: t.assignee ?? null,
      attempts: t.attempts,
    })),
    blockedOnYou,
    artifacts: {
      draft: ws.draft ?? null,
      revisions: Math.max(0, (ws.draftsWritten ?? 0) - 1),
      feedbackEcho: ws.feedbackEcho ?? null,
    },
  };
}

/** Zero-model snapshot read. NEVER drains the board (pure read). */
export const snapshot = handler({
  name: "wsvet-snapshot",
  inputSchema: z.unknown(),
  outputSchema: snapshotSchema,
  resources: loopResources,
  execute: async (_input, ctx: any) =>
    buildSnapshot(await boardCollection(ctx), ctx.resources.wsvetWorkspace.state, {
      checkGoal: true,
    }),
});

/** Control-mode snapshot: no acceptance criterion, no approval semantics. */
export const snapshotUnchecked = handler({
  name: "wsvet-snapshot-unchecked",
  inputSchema: z.unknown(),
  outputSchema: snapshotSchema,
  resources: loopResources,
  execute: async (_input, ctx: any) =>
    buildSnapshot(await boardCollection(ctx), ctx.resources.wsvetWorkspace.state, {
      checkGoal: false,
    }),
});

// ---------------------------------------------------------------------------
// Seeding and the human decision
// ---------------------------------------------------------------------------

/**
 * Seed the workstream: the draft task ONLY (`assignee: "drafter"`). No
 * approval task — `replan` creates the first one after the acceptance
 * criterion passes. Idempotent: a non-empty board is left untouched.
 */
export const seedStart = handler({
  name: "wsvet-seed",
  inputSchema: z.object({ goal: z.string() }),
  resources: loopResources,
  execute: async (input, ctx: any) => {
    const c = await boardCollection(ctx);
    if (c.count() > 0) return;
    await ctx.resources.wsvetWorkspace.updateState((s: WorkspaceState) => ({
      ...s,
      goal: input.goal,
    }));
    await c.addTask({
      goal: input.goal,
      title: "Draft",
      context: "Write the first draft.",
      assignee: DRAFTER,
      input: { feedback: null },
    });
  },
});

/**
 * The human's decision: `complete(taskId, { verdict, feedback })` on the
 * newest open approval task. Deliberately NOT `resumeFromReview` — re-pending
 * the task would make it claimable, and the registry router throws on the
 * unknown human assignee.
 */
export const applyDecision = handler({
  name: "wsvet-apply-decision",
  inputSchema: z.object({
    verdict: z.enum(["approve", "reject"]),
    feedback: z.string().nullable().default(null),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  resources: loopResources,
  execute: async (input, ctx: any) => {
    const c = await boardCollection(ctx);
    // Actionable only: an approval whose revise-dep hasn't completed is not
    // yet the human's to decide (mirrors blockedOnYou / classifyBoard).
    // Without this filter, a premature decide could mark the workstream done
    // before the revised draft exists.
    const completed = new Set(c.list({ status: "completed" }).map((t) => t.id));
    const open = c
      .list({ status: "awaiting_review", assignee: HUMAN_APPROVER })
      .filter((t) => (t.deps ?? []).every((dep) => completed.has(dep)))
      .sort((a, b) => taskTime(a) - taskTime(b));
    const task = open[open.length - 1];
    if (task === undefined) {
      throw new Error(
        "workstream-vet: no open approval task — nothing is blocked on you",
      );
    }
    await c.complete(task.id, {
      verdict: input.verdict,
      feedback: input.feedback ?? null,
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// The advance loop and the action roots
// ---------------------------------------------------------------------------

/** drain → classify → replan-if-asked → loop → snapshot. */
export const advanceLoop = sequencer({ name: "wsvet-advance" })
  .step(board.block)
  .step(doneWhen)
  .tapIf((d: WorkstreamDecision) => d.decision === "replan", replan)
  .loopBack(board.block.name, {
    when: (d: unknown) => (d as WorkstreamDecision).decision === "replan",
    maxIterations: 8,
  })
  .step(snapshot);

export const startAction = sequencer({
  name: "wsvet-start",
  inputSchema: z.object({ goal: z.string() }),
})
  .tap(seedStart)
  .step(advanceLoop);

export const decideAction = sequencer({
  name: "wsvet-decide",
  inputSchema: z.object({
    verdict: z.enum(["approve", "reject"]),
    feedback: z.string().nullable().default(null),
  }),
})
  .step(applyDecision)
  .step(advanceLoop);

/**
 * The control (spec: the falsifier): same drafter, same board wiring, but no
 * doneWhen / replan / approval — one drain, then a snapshot. Must be
 * behaviorally equivalent to planAndExecute on the same goal.
 */
export const startUncheckedAction = sequencer({
  name: "wsvet-start-unchecked",
  inputSchema: z.object({ goal: z.string() }),
})
  .tap(seedStart)
  .step(board.block)
  .step(snapshotUnchecked);
