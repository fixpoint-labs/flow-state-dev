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
  /** The admission writing: a request continued after its process died is admitted again, under a new one. */
  readonly writer?: string;
  /** When that admission was made: a later one of the same request supersedes an earlier one that never settled. */
  readonly admittedAt?: number;
  /** What that admission's ledger recovered from the request's log when it was admitted: its pending spend then. */
  readonly recovered?: RequestSpend;
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
  // One entry per admission of a request: a request continued in a new process
  // is admitted again under the same id, and each admission's live part and
  // ending stay its own, whichever order they land in.
  const writer = write.writer ?? null;
  const at = stored.requests.findIndex((entry) => entry.requestId === write.requestId && entry.writer === writer);
  const was: TaskSpendRequest =
    at < 0
      ? { requestId: write.requestId, settled: [], live: null, harness: null, harnessModel: null, model: null, writer, admittedAt: write.admittedAt ?? null, recovered: write.recovered === undefined ? null : (requestSpendSources(write.recovered) as TaskSpendSource[]) }
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
  if (at >= 0 && JSON.stringify(next) === JSON.stringify(stored.requests[at])) return undefined;
  // The entry that reported its harness or model last is the last one, so the
  // view names what ran most recently across requests: a running request's
  // write, or an ending that names something new. A late ending of an older
  // attempt naming what it always did stays where it is.
  const named = names.harness !== undefined || names.model !== undefined;
  const renamed = next.harness !== was.harness || next.harnessModel !== was.harnessModel || next.model !== was.model;
  const moved = at < 0 || (named && (write.part === "live" || renamed));
  const others = stored.requests.filter((_, i) => i !== at);
  const requests = moved ? [...others, next] : stored.requests.map((entry, i) => (i === at ? next : entry));
  return { requests };
}

/**
 * A task's spend, folded for a reader (FIX-2288), or `null` when the task
 * never ran in a request of its own. Every request counts, every attempt's
 * included; a request's live part counts until its ending settles it.
 *
 * An admission whose process died never settles: its live part stays. Once
 * a later admission of the same request has written, that part is superseded:
 * it counts less what the next admission recovered from the log (that one
 * reports those itself; a block that never finished logged nothing, so what
 * it spent is only here), and it no longer reads as running. An older next
 * admission that recorded nothing recovered drops its model calls and keeps
 * its harness runs whole. A predecessor's ending that is only late replaces its live part
 * with what it settles, so nothing counts twice. `live` is never true on a
 * terminal row either. `costUsd` sums the charges vendors reported, over
 * the same parts, and is `null` when none did (FIX-2398).
 */
export function taskSpendView(task: Pick<Task, "spend"> & Partial<Pick<Task, "status">>): TaskSpendView | null {
  if (task.spend == null) return null;
  const { requests } = taskSpendSchema.parse(task.spend);
  if (requests.length === 0) return null;
  let input = 0;
  let output = 0;
  let cost: number | null = null;
  let reportedAny = false;
  let unreported = false;
  // The next admission of the same request, if any: it supersedes this one's unsettled live part.
  const nextOf = (entry: TaskSpendRequest) =>
    requests
      .filter((other) => other.requestId === entry.requestId && other.writer !== entry.writer && (other.admittedAt ?? 0) > (entry.admittedAt ?? 0))
      .sort((a, b) => (a.admittedAt ?? 0) - (b.admittedAt ?? 0))[0];
  const superseded = (entry: TaskSpendRequest) => nextOf(entry) !== undefined;
  for (const entry of requests) {
    const next = entry.live === null ? undefined : nextOf(entry);
    const live = entry.live === null ? [] : next === undefined ? entry.live : unrecovered(entry.live, next.recovered);
    for (const source of [...entry.settled, ...live]) {
      input += source.inputTokens;
      output += source.outputTokens;
      if (source.costUsd !== null) cost = (cost ?? 0) + source.costUsd;
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
    costUsd: cost,
    unreported,
    live: (task.status === undefined || !isTerminalStatus(task.status)) && requests.some((entry) => entry.live !== null && !superseded(entry)),
  };
}

/**
 * One request's spend, read as a task's spend reads (FIX-2398): the row
 * {@link spendAfterWrite} settles from it, folded by {@link taskSpendView}.
 * `null` when it spent nothing. For a reader with a request and no task row,
 * such as a harness session's turn.
 */
export function requestSpendView(spend: RequestSpend, requestId: string): TaskSpendView | null {
  // A row that ran only this request, which then settled: the write and the fold a task's row gets.
  const settled = spendAfterWrite({ spend: null }, { requestId, part: "settle", spend });
  return settled === undefined ? null : taskSpendView({ status: "completed", spend: settled });
}

/**
 * A superseded admission's live part, less what its continuation recovered
 * from the log, source by source: only what was never logged. With nothing
 * recorded as recovered (an older row), its harness runs whole and no model
 * calls, as the continuation then recovered model calls only.
 */
function unrecovered(live: TaskSpendSource[], recovered: TaskSpendSource[] | null): TaskSpendSource[] {
  return live.flatMap((source) => {
    if (recovered === null) return source.kind === "harness" ? [source] : [];
    const logged = recovered.find((other) => other.kind === source.kind && other.source === source.source && other.billing === source.billing);
    if (logged === undefined) return [source];
    const left = (now: number, then: number) => Math.max(0, now - then);
    const kept = {
      ...source,
      inputTokens: left(source.inputTokens, logged.inputTokens),
      outputTokens: left(source.outputTokens, logged.outputTokens),
      runs: left(source.runs, logged.runs),
      unreported: left(source.unreported, logged.unreported),
      // The continuation reports the logged charge itself, as it does the tokens.
      costUsd: source.costUsd === null ? null : left(source.costUsd, logged.costUsd ?? 0),
    };
    // A charge left with no tokens is a run's later report the log missed: still owed.
    const charged = kept.costUsd !== null && kept.costUsd > 0;
    return !charged && kept.inputTokens === 0 && kept.outputTokens === 0 && (source.kind === "model" || kept.runs === 0) ? [] : [kept];
  });
}
