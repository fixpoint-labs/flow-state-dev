/**
 * Compile-time check that a worker block with its own typed input and output
 * goes into `taskBoard({ workers })` in an app on `strict: true`.
 *
 * The repo's own configs leave `strictFunctionTypes` off, so this file is also
 * compiled by `tsconfig.test-d-strict.json`, which turns `strict` on and reads
 * the packages the way an app does, through their built declarations. Under it
 * a block's `onCompleted(output)` is checked contravariantly against the
 * assignee type, which once refused every worker whose output was narrower
 * than `unknown` (TS2322). Typed workers are the normal case, so a regression
 * here makes the task board unusable from a strict app.
 */
import { handler } from "@flow-state-dev/core";
import { dispatcher } from "@flow-state-dev/core";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";

/** Typed output: the case the strict app hit. */
const summarize = handler({
  name: "summarize",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ summary: z.string() }),
  execute: () => ({ summary: "x" }),
});

/** Typed task payload as well as typed output. */
const review = handler({
  name: "review",
  inputSchema: taskWorkerInputSchema.extend({ input: z.object({ pr: z.number() }) }),
  outputSchema: z.object({ approved: z.boolean() }),
  execute: (input) => ({ approved: input.input.pr > 0 }),
});

// A registry of typed workers, and a typed floor.
taskBoard({ name: "registry", workers: { summarize, review }, defaultWorker: summarize });

// A typed uniform worker.
taskBoard({ name: "uniform", workers: summarize });

// A registry mixing a typed worker with a task dispatcher.
taskBoard({
  name: "mixed",
  mode: "delegation",
  workers: { summarize, remote: dispatcher({ name: "remote", type: "task", action: "summarize", session: "per-task" }) },
});

// Typed workers widen what a worker may take and return, not what an assignee
// is: a value that is not a block is still refused.
// @ts-expect-error -- an assignee is a block
taskBoard({ name: "not-a-block", workers: { summarize, bad: { name: "bad" } } });

