/**
 * The manager — a task row becomes a watched, settled coding run.
 *
 * One detached worker on a conductor board:
 *
 *   open the run row → build the prompt & take the checkout → run the harness
 *   → read the verdict → settle or fail
 *
 * Two things make the supervision real. The checkout is the run's OWN, rather
 * than whatever directory the server happens to sit in. And **one step decides
 * the verdict**, before the row is settled, so a run that produced nothing can
 * never close as done.
 *
 * ## The phase surface is options, not a record type
 *
 * A manager is constructed with a prompt builder, a done-condition re-evaluated
 * on each wake, and the collections the phase may read. Three values. A record
 * type, a registry, or a second phase module would be abstraction for a set of
 * one; when the spec and review phases arrive there will be a second shape to
 * generalise from.
 *
 * ## Where the throws go
 *
 * `decide` is the only place that DECIDES, and the chain-level rescue is the
 * only place that RECORDS a failure. Everything that can fail before the
 * verdict — a deleted branch, a wedged checkout, a prompt that cannot be
 * built, a mid-stream throw out of the SDK — arrives at the same handler, is
 * written to the row, and is re-thrown so the board's own fenced failure
 * recorder still routes it (back to `pending` with the reason as `feedback`,
 * or to `errored` once the retry budget is spent). Conductor adds no settlement
 * path of its own.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import type {
  BlockContext,
  DeclaredResourceEntry,
  DefinedResourceCollection,
} from "@flow-state-dev/core/types";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import type { TaskWorker } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import {
  RUNS,
  openRunRow,
  runRecordCollection,
  runTopic,
  writeRunRow,
  type AttemptIdentity,
} from "./run-record";
import {
  acquireCheckout,
  branchFor,
  checkoutPathFor,
  provisionCheckout,
  type CheckoutLease,
  type OwnershipBounds,
  type WorkspaceConfig,
} from "./workspace";

/** What a phase's prompt builder and done-condition are handed. */
export interface PhaseRunContext {
  issue: string;
  phase: string;
  /** Which attempt this is, as the board counted it. */
  attempt: number;
  /** The run's own checkout. */
  workspacePath: string;
  branch: string;
  /**
   * Why the LAST attempt stopped, as the board captured it when `fail()`
   * re-pended the row. This — not the run record — is the carry-forward:
   * without it a deterministic failure replays and the retry budget burns for
   * nothing.
   */
  feedback?: string;
  /** The block context, so a builder can read its phase's collections. */
  ctx: BlockContext;
}

/** Everything that makes one phase a phase. Three values, passed in. */
export interface PhaseSpec {
  /** The phase segment of the run record's topic. */
  phase: string;
  /** Rebuilt on every wake from current state, never computed when the row was filed. */
  buildPrompt(run: PhaseRunContext): string | Promise<string>;
  /**
   * Has the job actually been done? Re-evaluated now, and consulted ONLY after
   * a successful verdict — never as an alternative route to completion.
   */
  isDone(run: PhaseRunContext): boolean | Promise<boolean>;
  /**
   * Collections this phase's prompt builder may read, keyed by the accessor it
   * reads them under. The manager declares them so `ctx.resources` resolves.
   */
  readable: Record<string, DeclaredResourceEntry>;
}

/** How the manager is wired to its board and its host. */
export interface ManagerOptions {
  /** The board's ledger collection id — the fence reads the live claim from it. */
  boardCollectionId: string;
  /** The board's ledger declaration, so the manager can read a claim. */
  boardCollection: DefinedResourceCollection;
  phase: PhaseSpec;
  workspace: WorkspaceConfig;
  /** Wall-clock budget for the harness run itself. */
  runTimeoutMs: number;
  /** How checkout contention is bounded. Defaults derive from `runTimeoutMs`. */
  ownership?: Partial<OwnershipBounds>;
  /** Forwarded to the coding agent, so tests can script the SDK. */
  agent?: Omit<Parameters<typeof claudeCodeAgent>[0], "detached" | "recordWork" | "cwd">;
  name?: string;
}

/** The typed payload a conductor task carries. Not model-writable — see `./workspace`. */
export const conductorTaskInputSchema = z.object({
  /** The Linear issue this row drives. */
  issue: z.string(),
  /** Which phase of it. */
  phase: z.string(),
});

/**
 * The manager's per-run values.
 *
 * Sequencer state, not session state: a detached board refuses a worker that
 * declares session state, because every detached worker in a flow becomes a
 * route on one shared workstream flow where two routes choosing one key with
 * different shapes corrupt each other silently.
 */
const managerStateSchema = z.object({
  issue: z.string().nullable().default(null),
  phase: z.string().nullable().default(null),
  topic: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
  attempt: z.number().nullable().default(null),
  workspacePath: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
});

/** The manager's own result. Two outcomes; there is deliberately no third. */
const managerOutputSchema = z.object({
  issue: z.string(),
  phase: z.string(),
  sessionId: z.string().nullable(),
});

/**
 * An attempt failed. Carries only a message — the board captures it as
 * `feedback`, which is how the next attempt is told why this one stopped.
 */
export class ConductorAttemptFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConductorAttemptFailed";
  }
}

/** Read the typed payload off the worker input, refusing an unusable one loudly. */
function taskPayload(input: { input?: unknown; taskId: string }): {
  issue: string;
  phase: string;
} {
  const parsed = conductorTaskInputSchema.safeParse(input.input);
  if (!parsed.success) {
    throw new ConductorAttemptFailed(
      `[conductor] task ${input.taskId} carries no usable issue/phase payload: ` +
        `${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

/** The attempt identity every run-record write is fenced against. */
function identityFrom(ctx: BlockContext, boardCollectionId: string): AttemptIdentity {
  const state = ctx.sequencer?.state as z.infer<typeof managerStateSchema> | undefined;
  if (state?.topic == null || state.taskId == null || state.attempt == null) {
    throw new Error(
      "[conductor] the manager's sequencer state is empty — this block ran outside the " +
        "manager, or before the row was opened.",
    );
  }
  return {
    taskId: state.taskId,
    attempt: state.attempt,
    topic: state.topic,
    boardCollectionId,
  };
}

/** Read the manager's state, or throw rather than derive a wrong directory. */
function managerState(ctx: BlockContext): z.infer<typeof managerStateSchema> {
  const state = ctx.sequencer?.state as z.infer<typeof managerStateSchema> | undefined;
  if (state?.workspacePath == null) {
    throw new Error("[conductor] the manager's sequencer state has no checkout on it.");
  }
  return state;
}

/** Build the manager: one detached worker for one phase. */
export function harnessManager(options: ManagerOptions) {
  const {
    boardCollectionId,
    boardCollection,
    phase,
    workspace,
    runTimeoutMs,
    agent = {},
    name = "harness-manager",
  } = options;

  const ownership: OwnershipBounds = {
    // Sized against the lease-renewal lag that produces overlap, and well
    // inside the run's own deadline: an ordinary reclaim resolves in seconds.
    waitMs: options.ownership?.waitMs ?? 120_000,
    pollMs: options.ownership?.pollMs ?? 1_000,
    // Past the run's deadline, so a lock is declared stale only once no live
    // attempt could still hold it. That is what removes the need for a
    // heartbeat.
    staleAfterMs: options.ownership?.staleAfterMs ?? runTimeoutMs + 300_000,
  };

  /** Every collection the manager or its phase touches, by accessor key. */
  const resources: Record<string, DeclaredResourceEntry> = {
    [RUNS]: runRecordCollection,
    // Declared so the fence can read the LIVE claim off the board row. The
    // board declares the same definition object, so this is one registration
    // rather than a second storage slot that looks like the first.
    [boardCollectionId]: boardCollection as unknown as DeclaredResourceEntry,
    ...phase.readable,
  };

  /**
   * Open the row — BEFORE the attempt waits for anything.
   *
   * The checkout path is derived here rather than read back, so a task woken in
   * a coordinator session that never saw the previous run still resolves the
   * same directory (see `./workspace`).
   */
  const openRun = handler({
    name: "conductor-open-run",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.void(),
    resources,
    execute: async (input, ctx) => {
      const { issue, phase: phaseName } = taskPayload(input);
      const workspacePath = checkoutPathFor(workspace, issue, phaseName);
      const branch = branchFor(issue, phaseName);
      const topic = runTopic(issue, phaseName);

      await ctx.sequencer!.patchState({
        issue,
        phase: phaseName,
        topic,
        taskId: input.taskId,
        attempt: input.attempts,
        workspacePath,
        branch,
      });

      // A refusal here means this attempt was already superseded. It is not a
      // failure of the attempt and nothing is settled on it — the board's own
      // fence governs that. The write is simply not applied.
      await openRunRow(
        ctx as BlockContext,
        {
          taskId: input.taskId,
          attempt: input.attempts,
          topic,
          boardCollectionId,
        },
        { workspacePath, branch },
      );
    },
  });

  /**
   * Build the prompt, then take the checkout.
   *
   * Ownership is acquired LAST so nothing between the acquire and the harness
   * step can leak a held lock — the harness step's `onSettled` is what releases
   * it, and it only fires once the step has been dispatched.
   */
  const prepare = handler({
    name: "conductor-prepare",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ prompt: z.string() }),
    resources,
    execute: async (input, ctx) => {
      const state = managerState(ctx as BlockContext);
      const run: PhaseRunContext = {
        issue: state.issue!,
        phase: state.phase!,
        attempt: input.attempts,
        workspacePath: state.workspacePath!,
        branch: state.branch!,
        ...(input.feedback !== undefined ? { feedback: input.feedback } : {}),
        ctx: ctx as BlockContext,
      };

      const prompt = await phase.buildPrompt(run);
      await provisionCheckout(workspace, state.issue!, state.phase!);
      leases.set(leaseKey(ctx as BlockContext), await acquireCheckout(
        state.workspacePath!,
        `${input.taskId}#${input.attempts}`,
        ownership,
      ));
      return { prompt };
    },
  });

  /**
   * Read the verdict, then decide. **Completion is a conjunction.**
   *
   * A run can open the pull request and THEN exhaust its turn budget — the SDK
   * reports that as an errored handle rather than a throw, which is this whole
   * lab's premise. So a done-condition consulted alone would complete the row
   * for a run that failed, reintroducing the silent success through the door
   * meant to close it. A successful verdict whose done-condition does not hold
   * is a failed attempt too: the run finished cleanly and did not do the job.
   */
  const decide = handler({
    name: "conductor-decide",
    // Read off the handle. The verdict contract names FOUR optional fields —
    // session id, terminal text, usage and cost — so this reads four. An
    // attempt that reports three would otherwise leave the fourth showing the
    // previous attempt's value, silently and only on the attempts that could
    // not report it.
    inputSchema: z.object({
      status: z.string(),
      sessionId: z.string().nullable(),
      resultSubtype: z.string().nullable(),
      finalMessage: z.string().nullable(),
      usage: z
        .object({ inputTokens: z.number(), outputTokens: z.number() })
        .nullable(),
      costUsd: z.number().nullable(),
    }),
    outputSchema: managerOutputSchema,
    resources,
    execute: async (handle, ctx) => {
      const state = managerState(ctx as BlockContext);
      const identity = identityFrom(ctx as BlockContext, boardCollectionId);
      const succeeded = handle.status === "completed";

      // Everything the run reported goes on the row before anything is decided,
      // so a failed attempt's row is as complete as a successful one's.
      await writeRunRow(ctx as BlockContext, identity, {
        sessionId: handle.sessionId,
        finalMessage: handle.finalMessage,
        usage: handle.usage,
        costUsd: handle.costUsd,
        childSessionId: ctx.session.identity.id,
        requestId: ctx.request.identity.id,
      });

      if (!succeeded) {
        throw new ConductorAttemptFailed(
          `the run stopped without finishing: ${handle.resultSubtype ?? "no result reported"}`,
        );
      }

      const done = await phase.isDone({
        issue: state.issue!,
        phase: state.phase!,
        attempt: identity.attempt,
        workspacePath: state.workspacePath!,
        branch: state.branch!,
        ctx: ctx as BlockContext,
      });
      if (!done) {
        throw new ConductorAttemptFailed(
          `the run finished cleanly and the ${state.phase} phase is still not done`,
        );
      }

      await writeRunRow(ctx as BlockContext, identity, {
        outcome: "succeeded",
        reason: null,
      });
      return {
        issue: state.issue!,
        phase: state.phase!,
        sessionId: handle.sessionId,
      };
    },
  });

  /**
   * The one place a failure is written down — and it re-throws.
   *
   * A rescue handler receives the thrown error as its input and runs with the
   * sequencer's context, so it reaches the same state and the same fence every
   * other write uses. Re-throwing is what keeps settlement the board's: swallow
   * it here and the row would complete for an attempt that failed.
   */
  const recordFailure = handler({
    name: "conductor-record-failure",
    inputSchema: z.any(),
    outputSchema: z.never(),
    resources,
    execute: async (error: unknown, ctx): Promise<never> => {
      const reason = error instanceof Error ? error.message : String(error);
      const state = ctx.sequencer?.state as z.infer<typeof managerStateSchema> | undefined;
      // A failure BEFORE the row was opened has no identity to fence against —
      // and cannot have left stale metadata either, since nothing was written.
      if (state?.topic != null && state.taskId != null && state.attempt != null) {
        await writeRunRow(
          ctx as BlockContext,
          {
            taskId: state.taskId,
            attempt: state.attempt,
            topic: state.topic,
            boardCollectionId,
          },
          { outcome: "failed", reason },
        );
      }
      throw error;
    },
  });

  return sequencer({
    name,
    inputSchema: taskWorkerInputSchema,
    outputSchema: managerOutputSchema,
    stateSchema: managerStateSchema,
  })
    .tap(openRun)
    .step(prepare)
    .step(
      claudeCodeAgent({
        ...agent,
        // The board-construction shim: a detached board refuses a worker whose
        // block authors a session-state schema.
        detached: true,
        recordWork: true,
        // The framework's one addition, and the reason this lab needs it: the
        // run edits ITS checkout, and the record of what it touched is keyed
        // there too.
        cwd: (_input, ctx) => managerState(ctx).workspacePath!,
      }),
      {
        // The cancellable-under-a-deadline obligation, met by a primitive core
        // already has: this composes into the block's own signal, which the SDK
        // path forwards into the query's abort controller.
        abortSignal: () => AbortSignal.timeout(runTimeoutMs),
        // Fires on every exit from the dispatch — returned, threw, or
        // suspended. The tree is only written by the agent, so releasing the
        // moment it stops is tighter than holding through the verdict.
        onSettled: (ctx) => releaseLease(ctx),
      },
    )
    .step(decide)
    .rescue([{ block: recordFailure }]) as unknown as TaskWorker;
}

/**
 * Live checkout leases, keyed by the request holding them.
 *
 * Module-level because `onSettled` must be synchronous and gets only a context:
 * there is nowhere else to put a value that `prepare` created and the harness
 * step's exit has to release. Keyed by request so two managers in one process
 * — the whole point of a board — never release each other's.
 */
const leases = new Map<string, CheckoutLease>();

function leaseKey(ctx: BlockContext): string {
  return ctx.request.identity.id;
}

/**
 * Release this request's lease and forget it.
 *
 * Deleting matters as much as releasing: the entry is what keeps the lease
 * reachable, and a map that only ever grows would hold one object per run for
 * the process's life.
 */
function releaseLease(ctx: BlockContext): void {
  const key = leaseKey(ctx);
  leases.get(key)?.release();
  leases.delete(key);
}

export { RUNS };
