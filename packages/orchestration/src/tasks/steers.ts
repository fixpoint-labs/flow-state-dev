// FIX-2086.
/**
 * A task's steers: words sent into an open task, kept on the task.
 *
 * The pure decisions both backings share; the schema and the cap are the
 * leaf `schema/steer.ts`. A steer changes no status, no claim, and no attempt
 * count.
 */
import type { Task } from "./schema/task";
import { externalHoldOf, hasOpenHold, openOwnHolds, steerPlacesTaken, type QuestionAnswer } from "./collection/holds";
import { MAX_STEERS, type TaskSteer } from "./schema/steer";

/** What a sender hands the `steer` verb. */
export interface SteerInput {
  readonly message: string;
  readonly from: TaskSteer["from"];
  /** The user, when a person sent it. */
  readonly by?: string;
  /**
   * A key naming this steer, so the same steer sent twice (a replay, an
   * upgrade step run again) adds one. A fresh id when absent.
   */
  readonly key?: string;
}

// FIX-2133.
/** One steer as a worker is shown it: the words, who sent them, and the question they answer when they answer one. */
export interface ShownSteer {
  readonly message: string;
  readonly from: TaskSteer["from"];
  /** The question or confirm this steer answers, as it was asked. Absent on an external wait's answer, which answers no question. */
  readonly question?: string;
  // FIX-2578.
  /** A `"service"` steer's sender: its words are quoted as theirs, never the person's. */
  readonly by?: string;
}

/** `steer` as a worker on `task` is shown it: with the prompt of the question it answers, read off the task's holds. */
export function shownSteer(task: Pick<Task, "holds">, steer: Pick<TaskSteer, "message" | "from" | "answers" | "by">): ShownSteer {
  const hold = steer.answers === undefined ? undefined : task.holds?.find((h) => h.id === steer.answers);
  // An external wait's prompt is the board's own line, not something a worker asked.
  const question = hold === undefined || hold.ask.kind === "external" ? undefined : hold.ask.prompt;
  return {
    message: steer.message,
    from: steer.from,
    ...(question !== undefined ? { question } : {}),
    ...(steer.from === "service" && steer.by !== undefined ? { by: steer.by } : {}),
  };
}

/** The steers on `task` no request of its current attempt has taken. Rule 6 settles only when this is empty. */
export function untakenSteers(task: Pick<Task, "steers" | "attempts">): TaskSteer[] {
  return (task.steers ?? []).filter((steer) => steer.takenBy !== task.attempts);
}

/** The steers `task`'s current attempt took in the read named `takenIn`. */
export function steersTakenIn(task: Pick<Task, "steers" | "attempts">, takenIn: string): TaskSteer[] {
  return (task.steers ?? []).filter((steer) => steer.takenBy === task.attempts && steer.takenIn === takenIn);
}

// FIX-2133; FIX-2578.
/**
 * What a `steer` writes on `task`, decided inside the write: the patch, or
 * `"unchanged"` for a key already kept, or `"limit"` past {@link MAX_STEERS}.
 * Each open question keeps its answer's place under the cap, so a
 * own hold is always answerable: an ordinary steer is refused once the
 * steers and the open questions reach it.
 * A task running nothing while it waits on work it filed now waits on the
 * steer instead: a turn is owed for it (D2).
 * A running task's open external wait is answered by the steer, as
 * a line answers it: the steer wakes the wait and the same attempt is owed its
 * turn, in this write. Its answer has its place kept, so the cap never refuses it.
 */
export function steerWrite(
  task: Task,
  input: SteerInput,
  id: string,
  at: number
): { patch: Partial<Task> } | "unchanged" | "limit" {
  const steers = task.steers ?? [];
  if (input.key !== undefined && steers.some((steer) => steer.id === input.key)) return "unchanged";
  const wait = task.status === "in_progress" ? externalHoldOf(task) : undefined;
  if (wait === undefined && steerPlacesTaken(task) >= MAX_STEERS) return "limit";
  const steer: TaskSteer = {
    id: input.key ?? id,
    message: input.message,
    from: input.from,
    ...(input.by !== undefined ? { by: input.by } : {}),
    at,
    ...(wait !== undefined ? { answers: wait.id } : {}),
  };
  return {
    patch: {
      steers: [...steers, steer],
      // The turn owed for it is marked on the row (FIX-2133 D3), so the claim can take it when no wake does.
      ...(task.status === "in_progress" && task.keptOpenBy === "filed" ? { keptOpenBy: "steer" as const, turnOwed: true as const } : {}),
      ...(wait !== undefined ? { turnOwed: true as const } : {}),
    },
  };
}

/**
 * The steers after `takenBy` attempt took every untaken one in the read named
 * `takenIn`, or `undefined` when none was untaken. One this attempt already
 * took is left, so the same read after a crash still finds it.
 */
export function takeSteersPatch(task: Task, takenIn: string): Partial<Task> | undefined {
  // A held row's steers, and the answers that released it (`turnOwed`), are
  // the next turn's (FIX-2133): the turn that asked takes none of them.
  if (hasOpenHold(task) || task.turnOwed === true) return undefined;
  const steers = task.steers ?? [];
  if (!steers.some((steer) => steer.takenBy !== task.attempts)) return undefined;
  return {
    steers: steers.map((steer) => (steer.takenBy === task.attempts ? steer : { ...steer, takenBy: task.attempts, takenIn })),
  };
}

/**
 * The steers as the claim that starts `attempt` leaves them: every one taken
 * by it, for its brief. `undefined` on a row with none.
 */
export function steersForAttempt(steers: Task["steers"], attempt: number): Task["steers"] {
  if (steers === undefined || steers.length === 0) return steers;
  return steers.map(({ takenIn: _read, ...steer }) => ({ ...steer, takenBy: attempt }));
}

/** Why a person's line couldn't steer its task: the limit, the task finished first, or a board that keeps no steer. */
export type LineSteerRefusal = "steer-limit" | "finished" | "not-supported";

/**
 * What a person reads for each refusal, the same words on every door that
 * takes a line typed in a task's session.
 */
export const LINE_STEER_REFUSALS: Readonly<Record<LineSteerRefusal, string>> = {
  "steer-limit": "This task has taken as many messages as it can. Cancel it and file it again, or file a follow-up once it ends.",
  finished: "The task finished before your message reached it. Send it again to talk about it.",
  "not-supported": "This task's board takes no message.",
};

// FIX-2133.
/**
 * The board a line steers: its `steer` verb, which a board that keeps no
 * steers lacks, and its row as stored with the answer a question takes,
 * which a board that keeps no questions lacks.
 */
interface LineSteerLedger {
  readonly steer?: (id: string, input: SteerInput) => Promise<{ outcome: string; reason?: string } | undefined | void>;
  readonly answer?: (id: string, answer: QuestionAnswer) => Promise<{ outcome: string; reason?: string } | undefined | void>;
  readonly get?: (id: string) => Pick<Task, "status" | "holds" | "steers"> | undefined;
  readonly getCommitted?: (id: string) => Promise<Pick<Task, "status" | "holds" | "steers"> | undefined>;
}

// FIX-2578.
/**
 * The oldest open hold on `taskId` a line answers, as stored: a question, or
 * an external wait, which any line ends. Never a confirm, which a
 * typed line can't answer. `null` when the line keyed `key` is on the task
 * already (a replayed request): it is kept, and answers nothing more.
 */
async function oldestOpenQuestion(ledger: LineSteerLedger, taskId: string, key: string): Promise<string | null | undefined> {
  const row = ledger.getCommitted !== undefined ? await ledger.getCommitted(taskId) : ledger.get?.(taskId);
  if (row === undefined) return undefined;
  if ((row.steers ?? []).some((steer) => steer.id === key)) return null;
  return openOwnHolds(row).find((hold) => hold.ask.kind === "question" || hold.ask.kind === "external")?.id;
}

// BP-031.
/** The request a line arrived on: its verified user and its id, never its input. */
interface LineRequest {
  readonly user?: { readonly identity?: { readonly userId?: string } };
  readonly request: { readonly identity: { readonly id: string } };
}

// FIX-2133; FIX-2578; BP-031.
/**
 * Write a person's line, typed in an open task's session, as a steer on
 * `taskId`: from the user the request was verified as, keyed by the request
 * so a replayed request adds nothing.
 *
 * The one home for what a line answers: while the task holds open
 * questions, the line is the answer to the oldest, through the board's one
 * hold write, and the others stay open. An open external wait is
 * answered the same way: the line wakes it. Never a confirm: a typed line is no
 * yes or no, so a confirm is answered in the Inbox or by `updateTask`. The
 * server picks the question, never a client.
 *
 * @returns `undefined` once the steer is kept (or was already), else why not.
 */
export async function steerFromLine(
  ledger: LineSteerLedger,
  taskId: string,
  message: string,
  ctx: LineRequest
): Promise<LineSteerRefusal | undefined> {
  const by = ctx.user?.identity?.userId;
  if (ledger.answer !== undefined) {
    // Read again once if another answer took the oldest between the read and the write.
    for (let tries = 0; tries < 2; tries += 1) {
      const question = await oldestOpenQuestion(ledger, taskId, `line:${ctx.request.identity.id}`);
      if (question === null) return undefined;
      if (question === undefined) break;
      const answered = await ledger.answer(taskId, {
        questionId: question,
        message,
        from: "user",
        ...(by !== undefined ? { by } : {}),
        key: `line:${ctx.request.identity.id}`,
      });
      if (answered == null || answered.outcome !== "declined") return undefined;
      if (answered.reason !== "answered") return "finished";
    }
  }
  if (ledger.steer === undefined) return "not-supported";
  const outcome = await ledger.steer(taskId, {
    message,
    from: "user",
    ...(by !== undefined ? { by } : {}),
    key: `line:${ctx.request.identity.id}`,
  });
  if (outcome == null || outcome.outcome !== "declined") return undefined;
  return outcome.reason === "steer-limit" ? "steer-limit" : "finished";
}
