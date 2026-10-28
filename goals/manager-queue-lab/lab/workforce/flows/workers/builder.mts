/**
 * The `builder` worker flow — one file under `workforce/flows/workers/`,
 * basename = the flow every builder `WORKER.md` names in its `flow:` line.
 *
 * Three workers run on this one flow, one registered copy. Each takes tasks
 * through its `work` entry, built by Workforce's `workerTaskEntry`, which is
 * what makes a builder a delegate that takes a task: the manager, whose
 * `delegates:` names the three, has the task tools because of it. A filed
 * task runs here in a task session of its own, opened by the board of the
 * session that filed it and naming the worker the task was filed for.
 *
 * ## What the work reports, and why only that
 *
 * The turn is a stub that writes one line to a file outside the board and
 * returns. The line says only what the running work alone can know: which
 * worker this session runs as (resolved by the installation from the
 * session, as every turn's worker is), what that worker's **own file** says
 * in `answersFor:`, which task this session was opened for, and which
 * session it is. The row's `assignee` is never asked of the worker: it comes
 * off the stored row, where the filer put it, so the two sides of the routing
 * leg come from two different places.
 *
 * `answersFor:` routes nothing. No filing, hand-over or wiring reads it; the
 * turn reads it from the configuration its worker loaded and reports it back
 * out, so a check can ask whether the worker that ran a task carries the file
 * the task's assignee is declared by.
 *
 * ## The hold
 *
 * A turn may wait on the host's {@link BuilderWorkerFlowOptions.gate} before
 * it writes its line, so a check can read a task while it is running. The
 * gate is the host's, not a marker in the task: what a task says is the
 * filer's, and a stub that read instructions out of it would grade the filer
 * against the stub.
 */

import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  FILING_SESSION_STATE_KEY,
  TASK_ID_STATE_KEY,
  workerConfigSchema,
  workerMessagesResources,
  workerTaskEntry,
  type WorkerInstallation,
} from "@flow-state-dev/workforce";
import { taskLedgers } from "@flow-state-dev/orchestration/task-board";
import { appendFileSync } from "node:fs";
import { z } from "zod";
import { hearsMessages, workerDoor } from "../../../../../lib/worker-door.mts";

/** The flow every builder `WORKER.md` names. **Pinned** — the basename must match. */
export const BUILDER_KIND = "builder";

/** The task entry a filed task is handed over through. */
export const WORK_ENTRY = "work";

/**
 * The lab's own setting: what this worker's own file says in `answersFor:`.
 *
 * **Read by nothing that routes.** It is reported back out of a running task,
 * so a check can compare it with what the tree says for the task's assignee.
 */
const ANSWERS_FOR_KEY = "answersFor";

/** What a builder's settings bag holds: the contract, plus its own `answersFor:`. */
export function builderSettingsSchema() {
  return workerConfigSchema().extend({
    [ANSWERS_FOR_KEY]: z.string().min(1).optional(),
  });
}

/** One line the work leaves behind — a real file, outside the board entirely. */
export const workLineSchema = z.object({
  /** The worker this task session runs as, resolved from the session by the installation. */
  worker: z.string(),
  /** What that worker's OWN FILE says in `answersFor:`, from the configuration it loaded. */
  answersFor: z.string(),
  /** The task this session was opened for, off the session's readonly state. */
  taskId: z.string(),
  /** The session that filed it, off the session's readonly state. */
  filingSessionId: z.string(),
  /** What the task said, as the turn was handed it. */
  message: z.string(),
  /** The task session this ran in. */
  session: z.string(),
});

export type WorkLine = z.infer<typeof workLineSchema>;

export interface BuilderWorkerFlowOptions {
  /** The installation that runs this flow's workers. */
  installation: WorkerInstallation;
  /** Where a finished task leaves its line. A side effect outside the board. */
  outbox: string;
  /**
   * Awaited by every turn before it writes its line. The host holds it to
   * keep a task running while a check reads it; by default it is open.
   */
  gate?: () => Promise<void>;
  /**
   * Whether the `work` entry takes a conversation's tasks — `true` builds it
   * with `workerTaskEntry`. `false` builds the twin the tools leg reads: the
   * same flow with a `work` entry that takes tasks from no conversation's
   * board, so a worker on it is a delegate that takes nothing.
   */
  takesTasks?: boolean;
}

/** The parts of the bag this module reads where the bag's type is erased. */
interface BuilderConfig {
  answersFor?: string;
}

/**
 * Build the builder flow.
 *
 * @param options The installation, where finished work leaves its line, the
 *   host's gate, and whether the `work` entry takes a conversation's tasks.
 * @returns The flow `hireWorkforce` registers one copy of, for every builder.
 */
export function defineBuilderWorkerFlow(options: BuilderWorkerFlowOptions) {
  const { installation, outbox } = options;
  const gate = options.gate ?? (async () => undefined);

  const turn = handler({
    name: "builder-turn",
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.string(),
    resources: { ...installation.resources },
    execute: async (input: { message: string }, ctx: BlockContext) => {
      const worker = await installation.resolveWorker(ctx as never, BUILDER_KIND);
      const state = ctx.session.state as Record<string, unknown>;
      await gate();
      const line: WorkLine = {
        worker: worker.id,
        answersFor: String((worker.config as unknown as BuilderConfig).answersFor ?? ""),
        taskId: String(state[TASK_ID_STATE_KEY] ?? ""),
        filingSessionId: String(state[FILING_SESSION_STATE_KEY] ?? ""),
        message: input.message,
        session: String(ctx.session.identity.id),
      };
      appendFileSync(outbox, `${JSON.stringify(line)}\n`, "utf8");
      return `${worker.id} did: ${input.message}`;
    },
  });

  // The twin's entry takes tasks from a ledger that resolves nowhere, the
  // shape of a `work` entry gated to some other board: nothing marks it as
  // taking a conversation's task.
  const work =
    options.takesTasks === false
      ? {
          block: turn,
          from: taskLedgers({
            name: "builder-elsewhere",
            resolve: async () => undefined,
          }),
        }
      : workerTaskEntry({ name: "builder-task", turn });

  return defineFlow({
    kind: BUILDER_KIND,
    configSchema: builderSettingsSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources },
    actions: { ...workerDoor },
    internal: { actions: hearsMessages(installation, BUILDER_KIND) },
    task: { actions: { [WORK_ENTRY]: work } },
  } as never);
}
