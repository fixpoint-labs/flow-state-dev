/**
 * The `worker` flow — one file under `workforce/flows/workers/`, basename =
 * the flow every worker `WORKER.md` names in its `flow:` line. Both workers
 * are hired onto it, one registered copy.
 *
 * A worker takes tasks through its `work` entry, built by Workforce's
 * `workerTaskEntry`: that is what makes it a delegate that takes a task, and
 * what gives the planner, whose `delegates:` names both workers, its task
 * actions. A row the planner files runs here in a task session of its own,
 * opened by the planner's conversation's board and naming the worker the row
 * was filed for. No routing key is read here: the row's assignee is the
 * worker.
 *
 * ## What the work reports
 *
 * The turn appends one line to a file outside the board. Everything in it is
 * something only the running attempt can know: which worker this session runs
 * as, what that worker's **own file** says in `answersFor:`, which task and
 * attempt it is, which session it ran in, and the answer the row held. The
 * desk a row is for comes off the row the planner filed, so a check can grade
 * the two against each other without reading any routing.
 *
 * ## The ask condition is the one line that is not free
 *
 * A row held on its worker's question takes one more turn once the user
 * answers it (`updateTask` naming the question), on the same attempt, in the
 * same task session. The row still says what it asks, so a body that decides
 * to ask by looking at *what it was asked* asks again forever. What changed
 * is that the row carries an **answer** — so the body asks only while it
 * does not. `GOAL_CONTROL=ignore-the-answer` swaps that one decision for the
 * wrong one.
 *
 * The ask is written the way the worker's `askQuestion` tool writes it:
 * `askMidway` on the conversation's own ledger, under the claim this turn
 * holds, so the row holds on a question the user's Inbox lists. The turn is
 * not a model, so it asks itself rather than calling the tool.
 *
 * Nothing under `flows/` is read as a convention file — the loader walks
 * `workers/`, `skills/` and `resources/` under a team and ignores the rest,
 * which is why the code side can sit inside the tree.
 */

import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { askMidway } from "@flow-state-dev/orchestration/task-board";
import {
  getOrCreateTaskCollection,
  resolveResourceCollection,
  type TaskCollectionRef,
} from "@flow-state-dev/orchestration/tasks";
import {
  FILING_SESSION_STATE_KEY,
  TASK_ID_STATE_KEY,
  defineSessionBoard,
  workerConfigSchema,
  workerTaskEntry,
  type WorkerInstallation,
  MESSAGE_RECEIVED_ENTRY,
  messageReceivedEntry,
  workerMessagesResources,
} from "@flow-state-dev/workforce";
import { appendFileSync } from "node:fs";
import { z } from "zod";
import { pieceInputSchema } from "../piece.mts";
import { hearingDoor } from "../../../../run-lab/hearing-door.mts";

/** The flow every worker `WORKER.md` names in its `flow:` line. **Pinned** — the basename must match. */
export const WORKER_FLOW = "worker";

/** The task entry a filed row is handed over through. */
export const WORK_ENTRY = "work";

/** The conversation ledger's resource key, which the task actions are named for (`updateTask_tasks`). */
const LEDGER_KEY = "tasks";

/**
 * The worker-body perturbations, and only those. The routing controls
 * (`swapped-desks`, `one-worker`) are the filer's, because the assignee is.
 *
 * - `ignore-the-answer` — the body asks the question the row carries, not
 *   on whether the row has been answered. The answered row asks again and
 *   never finishes.
 * - `silent-park` — the body asks a question that says nothing ("?"). Every
 *   headless leg still passes; only the screen that should show *why* goes red.
 */
export type WorkerControl = "ignore-the-answer" | "silent-park";

/**
 * One line the work leaves behind — a real file, outside the board entirely.
 *
 * The board reports a completion on the very path under test, so execution is
 * proved here instead.
 */
export const workLineSchema = z.object({
  event: z.enum(["asked", "finished"]),
  /** The worker this task session runs as, resolved from the session by the installation. */
  worker: z.string(),
  /** What that worker's OWN FILE says it answers for — the oracle, from the tree. */
  declaredDesk: z.string(),
  taskId: z.string(),
  /** The row's attempt this line is from. */
  attempt: z.number(),
  goal: z.string(),
  /** The task session this attempt ran in. */
  session: z.string(),
  /** The conversation whose board filed the row, off the session's readonly state. */
  filingSession: z.string(),
  /** The answer on the row when this turn ran, if its question had been answered. */
  answer: z.string().nullable(),
});

export type WorkLine = z.infer<typeof workLineSchema>;

export interface WorkerFlowOptions {
  /** The installation whose workers run on this flow. */
  installation: WorkerInstallation;
  /** Where each attempt leaves its line. */
  outbox: string;
  /** A worker-body perturbation, or none. */
  control?: WorkerControl;
}

/**
 * Build the `worker` flow. Every worker is hired onto this one factory.
 *
 * @returns The flow `hireWorkforce` registers one copy of, which every worker runs on.
 */
export function defineWorkerFlow(options: WorkerFlowOptions) {
  const { installation, outbox, control } = options;
  // Only for the conversation ledger's declaration: a worker here files
  // nothing (no `delegates:`), so the flow carries none of the factory's actions.
  const { resources: ledgerResources } = defineSessionBoard({ installation, flowKind: WORKER_FLOW });

  /** The conversation's ledger at the partition this task session was opened for. */
  const ledgerOf = async (ctx: BlockContext): Promise<TaskCollectionRef> => {
    const filing = (ctx.session.state as Record<string, unknown>)[FILING_SESSION_STATE_KEY];
    const collection = resolveResourceCollection(ctx, LEDGER_KEY);
    if (typeof filing !== "string" || collection === undefined) {
      throw new Error(`this session was not opened by a conversation's board (filing: ${String(filing)})`);
    }
    return getOrCreateTaskCollection({
      ctx,
      backing: "resource",
      collectionId: LEDGER_KEY,
      collection,
      partition: filing,
      immutableAssignee: true,
    });
  };

  /**
   * One turn at one row. Asks the row's question while it has not been
   * answered; otherwise does the work and returns.
   */
  const turn = handler({
    name: "worker-turn",
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.string(),
    resources: { ...installation.resources, ...ledgerResources },
    execute: async (_input: { message: string }, ctx: BlockContext): Promise<string> => {
      const state = ctx.session.state as Record<string, unknown>;
      const taskId = String(state[TASK_ID_STATE_KEY] ?? "");
      const ledger = await ledgerOf(ctx);
      const row = ledger.get(taskId);
      if (row === undefined) throw new Error(`row ${taskId} is not on this conversation's board`);
      const piece = pieceInputSchema.parse(row.input ?? {});
      // The answer is the message that closed the row's question.
      const answer = (row.steers ?? []).find((steer) => steer.answers !== undefined)?.message ?? null;
      const worker = await installation.resolveWorker(ctx as never, WORKER_FLOW);
      const base = {
        worker: worker.id,
        declaredDesk: String((worker.config as { answersFor?: unknown }).answersFor),
        taskId,
        attempt: row.attempts,
        goal: row.goal,
        session: String(ctx.session.identity.id),
        filingSession: String(state[FILING_SESSION_STATE_KEY] ?? ""),
        answer,
      };

      // THE DECISION. Ask while nothing has answered the question. The wrong
      // version — ask whenever there is a question — is the control.
      const mustAsk = piece.asks !== undefined && (control === "ignore-the-answer" ? true : answer === null);
      if (mustAsk) {
        const line: WorkLine = { event: "asked", ...base };
        appendFileSync(outbox, `${JSON.stringify(line)}\n`, "utf8");
        // The worker that holds the row asks, and the row holds on the
        // question. Nobody answers on the user's behalf; the user answers
        // through the planner's conversation.
        const asked = await askMidway(ctx, ledger, [{ prompt: control === "silent-park" ? "?" : piece.asks! }]);
        if (!asked.ok) throw new Error(`row ${taskId} could not ask its question: ${JSON.stringify(asked)}`);
        return `${worker.id} asked: ${piece.asks}`;
      }

      const line: WorkLine = { event: "finished", ...base };
      appendFileSync(outbox, `${JSON.stringify(line)}\n`, "utf8");
      return `${worker.id} did: ${row.goal}`;
    },
  });

  return defineFlow({
    kind: WORKER_FLOW,
    cardinality: "collection",
    // Optional so the shared copy, which carries no worker's settings, builds;
    // the host refuses a worker whose file names no `answersFor`.
    configSchema: workerConfigSchema().extend({ answersFor: z.string().min(1).optional() }),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources },
    actions: { ...hearingDoor },
    internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: WORKER_FLOW }) } },
    task: { actions: { [WORK_ENTRY]: workerTaskEntry({ name: "worker-task", turn }) } },
  } as never);
}
