// (c) @flow-state-dev/harness-manager as LAB-154 §7 shapes it — the loop from
// labs/conductor/src/manager.ts with the `harness` slot feeding three, the lease as a
// value on state, and `decide` reading the neutral fields. Ask/park, the inbox and git are
// left out: this sketch is about the slot and the seams around it.
import { z } from "zod";
import { handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import type { TaskWorker } from "@flow-state-dev/orchestration/tasks";
import { harnessRunHandleSchema, type HarnessBlock, type HarnessResolver, type HarnessSessionHook } from "./contract";
import { world, type RunRow } from "./world";

/** The slot's one call: two resolvers the harness reads, one hook it calls (LAB-154 decision 2). */
export interface HarnessFeeds {
  cwd: HarnessResolver<string>;
  resume: HarnessResolver<string | null>;
  onSession: HarnessSessionHook;
}
export interface HarnessManagerOptions {
  name: string;
  harness: (feeds: HarnessFeeds) => HarnessBlock;
  runTimeoutMs: number;
  workspaceRoot: string;
  buildPrompt: (run: { goal: string; attempt: number; feedback?: string }) => string;
}

const stateSchema = z.object({
  taskId: z.string().nullable().default(null),
  attempt: z.number().nullable().default(null),
  workspacePath: z.string().nullable().default(null),
  previousSessionId: z.string().nullable().default(null),
  lockPath: z.string().nullable().default(null),
  lockToken: z.string().nullable().default(null),
});
type State = z.infer<typeof stateSchema>;
const state = (ctx: BlockContext) => ctx.sequencer!.state as State;
const row = (ctx: BlockContext) => world.rows.get(state(ctx).taskId!)!;

/** The one release, a function of state, called from both exits (LAB-154 §4 practice 3). */
function releaseFromState(ctx: BlockContext): void {
  const { lockPath, lockToken } = state(ctx);
  if (!lockPath || !lockToken) return;
  if (world.locks.get(lockPath) === lockToken) {
    world.locks.delete(lockPath);
    world.say(`lease released    ${lockPath} (token ${lockToken})`);
  }
}

export function harnessManager(options: HarnessManagerOptions) {
  const { name, runTimeoutMs, workspaceRoot, buildPrompt } = options;
  // The slot. Built once, over the manager's own state — the harness never learns its shape.
  const harness = options.harness({
    cwd: (_i, ctx) => state(ctx).workspacePath!,
    resume: (_i, ctx) => state(ctx).previousSessionId,
    onSession: (id, ctx) => {
      row(ctx).sessionId = id; // the sole writer of `sessionId`
      world.say(`hook: ${name} row.sessionId = ${id}`);
    },
  });

  const openRun = handler({
    name: `${name}-open`, inputSchema: taskWorkerInputSchema, outputSchema: z.void(),
    execute: async (input, ctx) => {
      const prev = world.rows.get(input.taskId);
      // Read the previous attempt's session BEFORE the opening write clears it.
      // LAB-154 §7 records `source` so LAB-141 can add "hand the id down only when it
      // matches the harness now dispatched". See compose.ts for whether that case exists.
      const previousSessionId = prev?.sessionId ?? null;
      const fresh: RunRow = { taskId: input.taskId, attempt: input.attempts, status: "open", sessionId: null, source: null, outcome: null, cost: null, reason: null };
      world.rows.set(input.taskId, fresh);
      await ctx.sequencer!.patchState({
        taskId: input.taskId, attempt: input.attempts, previousSessionId,
        workspacePath: `${workspaceRoot}/${input.taskId}`,
      });
      world.say(`open  ${name} ${input.taskId}#${input.attempts} previousSessionId=${previousSessionId}`);
    },
  });

  const prepare = handler({
    name: `${name}-prepare`, inputSchema: taskWorkerInputSchema, outputSchema: z.object({ prompt: z.string() }),
    execute: async (input, ctx) => {
      const s = state(ctx);
      const lockPath = `${s.workspacePath}.lock`;
      const lockToken = `${input.taskId}#${input.attempts}@${Math.random().toString(36).slice(2, 7)}`;
      if (world.locks.has(lockPath)) throw new Error(`checkout ${s.workspacePath} is leased to ${world.locks.get(lockPath)}`);
      world.locks.set(lockPath, lockToken);
      await ctx.sequencer!.patchState({ lockPath, lockToken });
      world.say(`lease acquired    ${lockPath} (token ${lockToken})`);
      return { prompt: buildPrompt({ goal: input.goal, attempt: input.attempts, feedback: input.feedback }) };
    },
  });

  const decide = handler({
    name: `${name}-decide`,
    inputSchema: harnessRunHandleSchema, // the neutral fields; no `resultSubtype`, no `costUsd`
    outputSchema: z.object({ verdict: z.enum(["done", "failed"]) }),
    execute: async (handle, ctx) => {
      const r = row(ctx);
      Object.assign(r, { source: handle.source, outcome: handle.outcome, cost: handle.cost });
      // `decide` reads the handle's sessionId for the verdict and writes it nowhere.
      const ok = handle.status === "completed";
      r.status = ok ? "completed" : "failed";
      r.reason = ok ? null : `the run stopped without finishing: ${handle.outcome ?? "no outcome reported"}`;
      world.say(`decide ${name}: ${r.status} outcome=${handle.outcome} cost=${handle.cost ? `${handle.cost.usd.toFixed(4)} (${handle.cost.basis})` : "null"} handle.sessionId=${handle.sessionId}`);
      return { verdict: ok ? ("done" as const) : ("failed" as const) };
    },
  });

  const recordFailure = handler({
    name: `${name}-record-failure`, inputSchema: z.unknown(), outputSchema: z.unknown(),
    execute: async (error, ctx) => {
      releaseFromState(ctx as BlockContext); // no-op if `onSettled` already did it
      const r = row(ctx as BlockContext);
      r.status = "failed"; r.reason = (error as Error).message; // sessionId untouched
      world.say(`rescue ${name}: failed — ${r.reason}; row.sessionId=${r.sessionId}`);
      throw error;
    },
  });

  return sequencer({ name, inputSchema: taskWorkerInputSchema, stateSchema })
    .tap(openRun)
    .step(prepare)
    .step(harness, {
      abortSignal: () => AbortSignal.timeout(runTimeoutMs),
      onSettled: (ctx) => releaseFromState(ctx),
    })
    .step(decide)
    .rescue([{ block: recordFailure }]) as unknown as TaskWorker;
}
