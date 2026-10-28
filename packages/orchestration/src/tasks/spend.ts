/**
 * A task's spend (FIX-2288): the write a task's run makes onto its row, and
 * the fold a reader shows.
 *
 * The run's request writes what it has spent so far (its live part) every few
 * seconds while that changes, and at each ending settles what the ending
 * handed on into its settled part, clearing the live part, in one write
 * (`TaskCollectionRef.recordSpend`, from `task-board/task-request.ts` only).
 * Both are core's one conversion of a request's spend into tokens per source,
 * so a task's tokens and its worker's Usage count alike.
 */
import { addRequestSpendSource, requestSpendSources, type RequestSpend } from "@flow-state-dev/core/types";
import { taskSpendSchema, type TaskSpend, type TaskSpendRequest, type TaskSpendSource, type TaskSpendView } from "./schema/spend";

export type { TaskSpendView };
import type { Task } from "./schema/task";
import { isTerminalStatus } from "./schema/task-status";

/** One spend write: a request's live part, or what its ending handed on. */
export interface TaskSpendWrite {
  /** The request admitted for the task. */
  readonly requestId: string;
  /** `live`: what it has spent since its last ending. `settle`: what an ending handed on. */
  readonly part: "live" | "settle";
  readonly spend: RequestSpend;
}

/** The harness and model a request's spend names last, if any. */
function namesOf(spend: RequestSpend): { harness?: string; harnessModel?: string | null; model?: string } {
  const run = spend.harnessRuns.at(-1);
  // `byModel` is keyed in last-called order, so the last key is the latest model.
  const model = Object.keys(spend.byModel).at(-1);
  return {
    ...(run !== undefined ? { harness: run.harness, harnessModel: run.model ?? null } : {}),
    ...(model !== undefined ? { model } : {}),
  };
}

/**
 * The row's `spend` after `write`, or `undefined` when it changes nothing (a
 * live part equal to the one stored). Pure: both backings run it inside their
 * write, against the committed row.
 */
export function spendAfterWrite(task: Pick<Task, "spend">, write: TaskSpendWrite): TaskSpend | undefined {
  const stored = task.spend == null ? { requests: [] } : taskSpendSchema.parse(task.spend);
  const at = stored.requests.findIndex((entry) => entry.requestId === write.requestId);
  const was: TaskSpendRequest =
    at < 0
      ? { requestId: write.requestId, settled: [], live: null, harness: null, harnessModel: null, model: null }
      : stored.requests[at]!;
  const sources = requestSpendSources(write.spend) as TaskSpendSource[];
  const names = namesOf(write.spend);
  // An ending that spent nothing, for a request that never wrote: no entry.
  if (at < 0 && write.part === "settle" && sources.length === 0) return undefined;
  const next: TaskSpendRequest = {
    ...was,
    ...(write.part === "settle"
      ? { settled: sources.reduce<TaskSpendSource[]>((all, source) => addRequestSpendSource(all, source) as TaskSpendSource[], was.settled), live: null }
      : { live: sources }),
    ...(names.harness !== undefined ? { harness: names.harness, harnessModel: names.harnessModel ?? null } : {}),
    ...(names.model !== undefined ? { model: names.model } : {}),
  };
  if (at >= 0 && JSON.stringify(next) === JSON.stringify(was)) return undefined;
  const requests = at < 0 ? [...stored.requests, next] : stored.requests.map((entry, i) => (i === at ? next : entry));
  return { requests };
}

/**
 * A task's spend, folded for a reader (FIX-2288), or `null` when the task
 * never ran in a request of its own. Every request counts, every attempt's
 * included; a request's live part counts until its ending settles it.
 *
 * `live` is never true on a terminal row: a request whose process died keeps
 * its last live part (its tokens were spent, so they still count), and no
 * ending will ever clear it, so the row's status, not the part, says the task
 * stopped running.
 */
export function taskSpendView(task: Pick<Task, "spend"> & Partial<Pick<Task, "status">>): TaskSpendView | null {
  if (task.spend == null) return null;
  const { requests } = taskSpendSchema.parse(task.spend);
  if (requests.length === 0) return null;
  let input = 0;
  let output = 0;
  let reportedAny = false;
  let unreported = false;
  for (const entry of requests) {
    for (const source of [...entry.settled, ...(entry.live ?? [])]) {
      input += source.inputTokens;
      output += source.outputTokens;
      if (source.kind === "model" || source.runs > source.unreported) reportedAny = true;
      if (source.unreported > 0) unreported = true;
    }
  }
  const harnessed = [...requests].reverse().find((entry) => entry.harness !== null);
  const modelled = [...requests].reverse().find((entry) => entry.model !== null);
  return {
    harness: harnessed?.harness ?? null,
    model: harnessed !== undefined ? harnessed.harnessModel : (modelled?.model ?? null),
    inputTokens: reportedAny ? input : null,
    outputTokens: reportedAny ? output : null,
    unreported,
    live: (task.status === undefined || !isTerminalStatus(task.status)) && requests.some((entry) => entry.live !== null),
  };
}
