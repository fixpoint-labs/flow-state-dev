// (d) LAB-141 — "a clean block-oriented way to bring the harnesses together under one
// manager". Neither LAB-141 (unspecced) nor the epic picked between "per-phase" and "a
// router on a task field". This sketch takes the shape the substrate already has: a task
// board's worker registry IS a router keyed by `task.assignee`, so two managers — same
// package, different slot — under two assignees is the whole composition. Nothing new.
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { claudeCodeAgent } from "./claude-harness";
import { codexAgent } from "./codex-harness";
import { harnessManager } from "./manager";

const buildPrompt = (run: { goal: string; attempt: number; feedback?: string }) =>
  `Attempt ${run.attempt}: ${run.goal}${run.feedback ? ` (last time: ${run.feedback})` : ""}`;

export const claudeManager = harnessManager({
  name: "manager-claude", runTimeoutMs: 500, workspaceRoot: "/checkouts", buildPrompt,
  harness: ({ cwd, resume, onSession }) =>
    claudeCodeAgent({ cwd, resume, onSession, detached: true, recordWork: true }),
});

export const codexManager = harnessManager({
  name: "manager-codex", runTimeoutMs: 60, workspaceRoot: "/checkouts", buildPrompt,
  harness: ({ cwd, resume, onSession }) =>
    // LAB-153 names the hook `onThread`; the slot names it `onSession`. The host maps it.
    codexAgent({ cwd, resume, onThread: onSession, commandMs: 150,
      thread: { model: "gpt-5.4-mini", sandboxMode: "workspace-write", approvalPolicy: "never" } }),
});

/** The harness IS the assignee. Choosing per task = seeding the row with one of these. */
export const HARNESSES = ["claude-code", "codex"] as const;
export type Harness = (typeof HARNESSES)[number];

export const tasks = defineTaskCollection({ id: "poc-harness-ledger", scope: "user" });

export const board = taskBoard({
  name: "harness-board",
  boardId: "poc-harness-board",
  collection: tasks,
  concurrency: 1,
  onReview: "exit",
  workers: {
    "claude-code": { worker: claudeManager, dispatch: { mode: "detached" as const } },
    codex: { worker: codexManager, dispatch: { mode: "detached" as const } },
  } satisfies Record<Harness, unknown>,
});

/** What conductor's `seed` action would grow: the harness picked per task, as the assignee. */
export function seedRow(issue: string, harness: Harness) {
  return { id: `${issue}/implement`, goal: `implement ${issue}`, assignee: harness };
}
