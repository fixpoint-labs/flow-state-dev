/**
 * The fixture flow: one durable task board, its task tools as actions, and
 * five app actions shaped as the goal's row legs.
 *
 * Every leg action takes a `taskId`, so the DevTool offers it on each row, and
 * answers with a value the goal check fixes through `ROW_RESULT_ANSWERS` (the
 * fixture's `answers`, held out). Each is shaped as one of the cases a trace
 * reading could not see:
 *
 * - `handover`  — a transient block refuses. Nothing it traced is persisted.
 * - `hook`      — a refusal, with the flow's completion hooks running after it
 *                 as root blocks of the same request.
 * - `ref`       — a success whose value a sequencer holds by reference to its
 *                 step's trace.
 * - `suspend`   — suspends for a person, and answers with what they resumed it
 *                 with.
 * - `hookFails` — refuses, then the action's own completion hook throws, so the
 *                 request fails after the action answered.
 *
 * No model anywhere: every block is a deterministic handler.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { taskBoard, taskToolActions } from "@flow-state-dev/orchestration/task-board";
import { defineTaskCollection, type TaskWorker } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";

/** The flow kind the goal check addresses, and the board its rows are on. */
export const ROW_RESULTS_KIND = "row-results";
export const ROW_BOARD = "rows";

/** The answers each leg returns, fixed by the goal check. */
export type RowAnswers = {
  handover: string;
  hook: string;
  ref: unknown;
  suspend: string;
  hookFails: { refusal: string; error: string };
};

const taskInput = z.object({ taskId: z.string() });

const noopWorker = handler({
  name: "row-results-noop-worker",
  inputSchema: z.unknown(),
  outputSchema: z.null(),
  execute: () => null,
}) as TaskWorker;

/** Build the flow for one set of answers. */
export function rowResultsFlow(answers: RowAnswers) {
  const rows = defineTaskCollection({ id: ROW_BOARD, scope: "session" });
  const board = taskBoard({ name: ROW_BOARD, collection: rows, workers: noopWorker });

  const refStep = handler({
    name: "row-results-ref-step",
    inputSchema: taskInput,
    execute: () => answers.ref,
  });

  const gate = handler({
    name: "row-results-gate",
    inputSchema: z.unknown(),
    execute: async (_input, ctx) => {
      const decision = (await ctx.suspend!({
        reason: "human_input",
        message: "Answer this row",
        resumeSchema: { type: "object", properties: { answer: { type: "string" } } },
      })) as { answer?: string } | undefined;
      return { ok: true, answer: decision?.answer ?? null };
    },
  });

  // Root blocks of every request, before and after its action, taking the
  // request's own id as input: what a trace reading had to tell apart.
  const hookBlock = (name: string) =>
    handler({ name, inputSchema: z.unknown(), execute: () => ({ observed: name }) });

  return defineFlow({
    kind: ROW_RESULTS_KIND,
    request: {
      onStarted: hookBlock("row-results-on-started"),
      onCompleted: hookBlock("row-results-on-completed"),
      onFinished: hookBlock("row-results-on-finished"),
    },
    actions: {
      ...taskToolActions(board),
      handover: {
        inputSchema: taskInput,
        block: handler({
          name: "row-results-handover",
          transient: true,
          inputSchema: taskInput,
          execute: () => ({ ok: false, error: answers.handover }),
        }),
      },
      hook: {
        inputSchema: taskInput,
        block: handler({
          name: "row-results-hook",
          inputSchema: taskInput,
          execute: () => ({ ok: false, error: answers.hook }),
        }),
      },
      ref: {
        inputSchema: taskInput,
        block: sequencer({ name: "row-results-ref", inputSchema: taskInput }).step(refStep),
      },
      suspend: {
        inputSchema: taskInput,
        durable: true,
        block: sequencer({ name: "row-results-suspend", durable: true, inputSchema: taskInput }).step(gate),
      },
      hookFails: {
        inputSchema: taskInput,
        block: handler({
          name: "row-results-hook-fails",
          inputSchema: taskInput,
          execute: () => ({ ok: false, error: answers.hookFails.refusal }),
        }),
        onCompleted: handler({
          name: "row-results-failing-hook",
          inputSchema: z.unknown(),
          execute: () => {
            throw new Error(answers.hookFails.error);
          },
        }),
      },
    },
  } as never);
}
