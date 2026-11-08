// FIX-2317; FIX-2133 D2; the epic FIX-2058's ER-8.
/**
 * The one hold write, and the one predicate every reader asks of it, *open
 * holds* (a question is one kind of
 * hold).
 *
 * Both backings call {@link holdWrite} for every change to `Task.holds`, decided
 * on the committed row inside their write: a filing or a midway ask opens row
 * holds, an answer or a deadline releases one, the claim gate's stop arm opens
 * a task run's mirror and its resume closes it. Cancel closes every hold with
 * the row: an ended row has no open hold ({@link openHolds}), and its mirror
 * stays only as the address of the `cancelled` resume it owes
 * ({@link keptOnEnding}).
 *
 * Pure: reads the row it is handed and nothing else, so two writes at once
 * decide on the row each committed against, and the backing's conditional
 * write lets one through.
 */
import { generateId } from "../generate-id";
import type { Task } from "../schema/task";
import { isTerminalStatus } from "../schema/task-status";
import { MAX_QUESTION_PROMPT, withCurrentHoldMarker, type ExternalWait, type QuestionInit, type OwnHold, type SuspensionHold, type TaskHold } from "../schema/hold";
import { MAX_STEERS, type TaskSteer } from "../schema/steer";
import type { TaskWriteDeclineReason } from "./types";

/** What the board's steer says when it closes a question at a deadline a host set. */
export const NO_ANSWER_CAME = "No answer came before this question's deadline. Go on from your brief without it.";

// FIX-2479 D1 (BP-030).
/**
 * Whether `hold` is a task's own hold (a question, a confirm or an external
 * wait). Takes a hold its caller never parsed too (a replayed stream item, a
 * raw store read): its marker is read forward first ({@link withCurrentHoldMarker}).
 */
export function isOwnHold(hold: { readonly source: { readonly kind: string } }): hold is OwnHold {
  return withCurrentHoldMarker(hold).source.kind === "task";
}

// FIX-2578.
/**
 * Whether `hold` is an external wait: the running turn waits on something
 * outside the board. Reads an unparsed hold as {@link isOwnHold} does.
 */
export function isExternalHold(hold: { readonly source: { readonly kind: string }; readonly ask: { readonly kind: string } }): hold is OwnHold {
  return isOwnHold(hold) && hold.ask.kind === "external";
}

/** Whether `hold` mirrors a task run's stop. */
export function isSuspensionHold(hold: TaskHold): hold is SuspensionHold {
  return hold.source.kind === "suspension";
}

/** The steer that answers own question `questionId` on `row`, if one does. */
export function answerOf(row: Pick<Task, "steers">, questionId: string): TaskSteer | undefined {
  return (row.steers ?? []).find((steer) => steer.answers === questionId);
}

/**
 * **Open questions**, the one predicate (ER-8): what `row` waits on now, oldest
 * first. None on an ended row: a cancel closes every question. A task's own question is open
 * while no steer carries its id; a suspension question, while it is on the row.
 */
export function openHolds(row: Pick<Task, "status" | "holds" | "steers">): TaskHold[] {
  if (row.holds === undefined || row.holds.length === 0 || isTerminalStatus(row.status)) return [];
  return row.holds.filter((hold) => !isOwnHold(hold) || answerOf(row, hold.id) === undefined);
}

// FIX-2133.
/**
 * The turn-asked fact: whether `row` records that the turn a
 * ticket holds asked questions midway, on that ticket's attempt. The one
 * reading of `askedInTurn`; each caller adds what its own rule needs on top
 * (the request's own flag, the row's current turn).
 */
export function askedOnTicket(row: Pick<Task, "askedInTurn" | "attempts"> | undefined, ticket: { readonly turn: number; readonly attempt: number }): boolean {
  return row !== undefined && row.askedInTurn !== undefined && row.askedInTurn === ticket.turn && row.attempts === ticket.attempt;
}

/** Whether `row` waits on anything now. */
export function hasOpenHold(row: Pick<Task, "status" | "holds" | "steers">): boolean {
  return openHolds(row).length > 0;
}

// FIX-2578.
/**
 * **Who `row` waits on now**, the one reading of a hold's `actor`:
 * `"user"` while any open hold is a person's (a question, a confirm, a run's
 * stop for a person), else `"system"` while an external wait is open, else
 * `undefined`. A reader that says "waiting on a user" asks for `"user"`; one
 * that only needs "nothing in a drain moves it" asks for any.
 */
export function holdActorOf(row: Pick<Task, "status" | "holds" | "steers">): "user" | "system" | undefined {
  const open = openHolds(row);
  if (open.length === 0) return undefined;
  return open.some((hold) => hold.actor === "user") ? "user" : "system";
}

// FIX-2578.
/** The row's open external wait, if it has one: a turn opens at most one. */
export function externalHoldOf(row: Pick<Task, "status" | "holds" | "steers">): OwnHold | undefined {
  return openHolds(row).find(isExternalHold) as OwnHold | undefined;
}

/** The row's open questions and confirms, oldest first. */
export function openOwnHolds(row: Pick<Task, "status" | "holds" | "steers">): OwnHold[] {
  return openHolds(row).filter(isOwnHold);
}

/**
 * The row's suspension question: the mirror of its run's stop, open while the row
 * runs, and kept on an ended row until the resume it owes is paid. A row's
 * open questions come from one source at a time, so it has at most one.
 */
export function suspensionHoldOf(row: Pick<Task, "holds">): SuspensionHold | undefined {
  return row.holds?.find(isSuspensionHold);
}

/** How many steer places `row` has taken or reserved: its steers, and one per open own question (its answer's). */
export function steerPlacesTaken(row: Pick<Task, "status" | "holds" | "steers">): number {
  return (row.steers?.length ?? 0) + openOwnHolds(row).length;
}

/**
 * Refuse a midway ask {@link askProblem} names, at the collection's `ask`
 * entry in both backings, as filing refuses one: an ask that opened nothing
 * would still drop the turn's lease.
 *
 * @throws {Error} naming the problem
 */
export function assertAskable(asks: readonly QuestionInit[]): void {
  const problem = askProblem(asks);
  if (problem !== undefined) throw new Error(`[tasks] ask: ${problem}, so the task can't wait on them. Nothing was written.`);
}

/**
 * Why `asks` can't be asked, or `undefined` when they can: none, a prompt
 * empty or past {@link MAX_QUESTION_PROMPT} characters, or more than a row takes
 * ({@link MAX_STEERS}, the places their answers reserve).
 */
export function askProblem(asks: readonly QuestionInit[]): string | undefined {
  if (asks.length === 0) return "no question was asked";
  if (asks.length > MAX_STEERS) return `a task holds at most ${MAX_STEERS} questions, and ${asks.length} were asked`;
  const misplaced = asks.findIndex((ask) => ask.kind === "question" && ask.onNo !== undefined);
  if (misplaced >= 0) return `question ${misplaced + 1} is a question, and only a confirm takes onNo`;
  const blank = asks.findIndex((ask) => ask.prompt.trim().length === 0);
  if (blank >= 0) return `question ${blank + 1} is empty`;
  const long = asks.findIndex((ask) => ask.prompt.length > MAX_QUESTION_PROMPT);
  if (long >= 0) return `question ${long + 1} is ${asks[long]!.prompt.length} characters, past the ${MAX_QUESTION_PROMPT} a task keeps`;
  return undefined;
}

/** The own questions `asks` open, each with a fresh id, from `at`, due `dueMs` later when a deadline is set. */
export function newOwnHolds(asks: readonly QuestionInit[], at: number, options: { readonly dueMs?: number; readonly midway?: boolean } = {}): OwnHold[] {
  return asks.map((ask) => ({
    id: generateId("question"),
    actor: "user" as const,
    openedAt: at,
    ...(options.dueMs !== undefined ? { due: at + options.dueMs } : {}),
    source: { kind: "task" as const, closedBy: [{ by: "answer" as const }] },
    ask: {
      kind: ask.kind,
      prompt: ask.prompt,
      ...(ask.title !== undefined ? { title: ask.title } : {}),
      // What a confirm's No does, stored from its first write: cancel unless its filer said continue.
      ...(ask.kind === "confirm" ? { onNo: ask.onNo ?? ("cancel" as const) } : {}),
    },
    ...(options.midway === true ? { midway: true as const } : {}),
  }));
}

/**
 * Why an external wait can't be opened, or `undefined` when it can: a prompt
 * empty or past {@link MAX_QUESTION_PROMPT} characters, or no event to wait on.
 */
export function externalWaitProblem(wait: ExternalWait): string | undefined {
  if (wait.events.length === 0) return "it waits on no event";
  if (wait.events.some((event) => event.event.trim() === "" || event.key.trim() === "")) return "an event it waits on has no name or key";
  if (wait.prompt.trim().length === 0) return "its prompt is empty";
  if (wait.prompt.length > MAX_QUESTION_PROMPT) return `its prompt is ${wait.prompt.length} characters, past the ${MAX_QUESTION_PROMPT} a task keeps`;
  return undefined;
}

// FIX-2578.
/**
 * The one constructor of an external wait: `actor: "system"`, kind
 * `external`, one `{ by: "event" }` releaser per event, opened at `at`. Never
 * `midway`, so its filer is not told of it as a question, and no deadline:
 * it waits until a steer answers it or the task is cancelled.
 */
export function newExternalHold(wait: ExternalWait, at: number): OwnHold {
  return {
    id: generateId("wait"),
    actor: "system",
    openedAt: at,
    source: { kind: "task", closedBy: wait.events.map((event) => ({ by: "event" as const, event: event.event, key: event.key })) },
    ask: { kind: "external", prompt: wait.prompt, ...(wait.title !== undefined ? { title: wait.title } : {}) },
  };
}

/** An answer to one own hold: the user's words, the filer's for a midway question, or a service's for an external wait. */
export interface QuestionAnswer {
  /** The own hold it answers. */
  readonly questionId: string;
  readonly message: string;
  // FIX-2578.
  /**
   * Who sent it: a person (`"user"`), the filer for a midway question
   * (`"filer"`), or words from outside the app, a delivered message
   * (`"service"`), whose sender is `by`.
   */
  readonly from: "user" | "filer" | "service";
  /** The user who answered, server-set; for a `"service"` answer, the sender's handle. */
  readonly by?: string;
  /**
   * A key naming this answer, so the same request run again adds nothing
   * (a line typed in the task's session is keyed by its request). Its steer's
   * id; a fresh one when absent.
   */
  readonly key?: string;
}

/** Every change to `Task.holds`. */
export type HoldChange =
  /** A midway ask, or an external wait: the turn holding the claim opens own holds. The caller fences it on the claim. */
  | { readonly op: "ask"; readonly holds: readonly OwnHold[] }
  /** An answer, kept as the user's steer carrying the question's id; `steerId` is minted once, outside the write. */
  | { readonly op: "answer"; readonly answer: QuestionAnswer; readonly steerId: string; readonly at: number }
  /** A touch of the board at `at`: every open own question past its due time closes "no answer came". */
  | { readonly op: "deadline"; readonly at: number }
  /** The claim gate's stop arm mirrors its run's stop. */
  | { readonly op: "mirror"; readonly hold: SuspensionHold }
  /** The write that admits the run's resume closes the mirror. */
  | { readonly op: "resume" };

/** What a question write decided: the patch, nothing to write, or why it is refused. */
export type HoldWriteResult = { readonly patch: Partial<Task> } | "unchanged" | { readonly decline: TaskWriteDeclineReason };

/**
 * The patch that follows a write closing own questions on `next`: none left open
 * on a running row owes one more turn on its same attempt (D3). A pending row
 * needs nothing: with no open question it is claimable, its first attempt a start.
 */
function released(before: Task, next: Pick<Task, "status" | "holds" | "steers">): Partial<Task> {
  const wasHeld = openOwnHolds(before).length > 0;
  if (!wasHeld || openOwnHolds(next).length > 0 || before.status !== "in_progress") return {};
  return { turnOwed: true };
}

// FIX-2578.
/**
 * The one question write (ER-8), decided on the committed row `task`.
 *
 * - `ask`: refused `open-question` while a suspension questions the row (one wait per
 *   turn, one source at a time), and `steer-limit` when its answers would
 *   take the row past {@link MAX_STEERS} places. An external wait
 *   opened over a line no request of the attempt took, one that landed after
 *   the turn's last steer check, opens answered by it: the line is what wakes
 *   the wait, so the same attempt is owed its turn in this write, and the line
 *   is never left behind a wait nobody else may end.
 * - `answer`: the same words from the same sender again are `unchanged`, even
 *   on a row that has since finished (a retry after a lost response). Other
 *   words, or another sender, are refused `answered`; a finished row,
 *   `terminal`; an id that isn't a task's own question on it, `no-such-question`. The last
 *   open own question's answer releases the row.
 * - `deadline`: every open own question past its `due` closes with the board's
 *   "no answer came" steer; one with no `due` never does.
 * - `mirror`: refused `open-question` while a task's own question is open. `unchanged` for the
 *   same stop already mirrored.
 * - `resume`: drops the mirror.
 */
export function holdWrite(task: Task, change: HoldChange): HoldWriteResult {
  switch (change.op) {
    case "ask": {
      if (isTerminalStatus(task.status)) return { decline: "terminal" };
      if (openHolds(task).some(isSuspensionHold)) return { decline: "open-question" };
      if (steerPlacesTaken(task) + change.holds.length > MAX_STEERS) return { decline: "steer-limit" };
      const holds = [...(task.holds ?? []), ...change.holds];
      const opened = { holds, leaseUntil: undefined, askedInTurn: task.turn ?? 0 };
      const wait = change.holds.length === 1 && isExternalHold(change.holds[0]!) ? change.holds[0]! : undefined;
      const waiting = wait === undefined ? undefined : (task.steers ?? []).find((steer) => steer.takenBy !== task.attempts && steer.answers === undefined);
      if (wait === undefined || waiting === undefined || task.status !== "in_progress") return { patch: opened };
      const steers = (task.steers ?? []).map((steer) => (steer.id === waiting.id ? { ...steer, answers: wait.id } : steer));
      return { patch: { ...opened, steers, turnOwed: true } };
    }
    case "answer": {
      const { answer } = change;
      // The same keyed answer again (a replayed request) adds nothing, whatever it answered then.
      if (answer.key !== undefined && (task.steers ?? []).some((steer) => steer.id === answer.key)) return "unchanged";
      const kept = answerOf(task, answer.questionId);
      // Checked before the terminal guard: a retry's answer is done, whatever the row did since.
      if (kept !== undefined) {
        const same = kept.message === answer.message && kept.from === answer.from && kept.by === answer.by;
        return same ? "unchanged" : { decline: "answered" };
      }
      if (isTerminalStatus(task.status)) return { decline: "terminal" };
      const hold = task.holds?.find((h) => h.id === answer.questionId);
      if (hold === undefined || !isOwnHold(hold)) return { decline: "no-such-question" };
      const steer: TaskSteer = {
        id: answer.key ?? change.steerId,
        message: answer.message,
        from: answer.from,
        ...(answer.by !== undefined ? { by: answer.by } : {}),
        at: change.at,
        answers: hold.id,
      };
      const next = { ...task, steers: [...(task.steers ?? []), steer] };
      return { patch: { steers: next.steers, ...released(task, next) } };
    }
    case "deadline": {
      const due = holdsDue(task, change.at);
      if (due.length === 0) return "unchanged";
      const closing: TaskSteer[] = due.map((hold) => ({
        id: `deadline:${hold.id}`,
        message: NO_ANSWER_CAME,
        from: "board",
        at: change.at,
        answers: hold.id,
      }));
      const next = { ...task, steers: [...(task.steers ?? []), ...closing] };
      return { patch: { steers: next.steers, ...released(task, next) } };
    }
    case "mirror": {
      if (openOwnHolds(task).length > 0) return { decline: "open-question" };
      const kept = suspensionHoldOf(task);
      if (kept?.source.suspensionId === change.hold.source.suspensionId) return "unchanged";
      return { patch: { holds: [...(task.holds ?? []).filter((h) => !isSuspensionHold(h)), change.hold] } };
    }
    case "resume": {
      if (suspensionHoldOf(task) === undefined) return "unchanged";
      return { patch: { holds: withoutMirror(task.holds) } };
    }
  }
}

/** `holds` with the mirror taken out; `undefined` when nothing is left. */
function withoutMirror(holds: Task["holds"]): Task["holds"] {
  const rest = (holds ?? []).filter((hold) => !isSuspensionHold(hold));
  return rest.length === 0 ? undefined : rest;
}

/**
 * What an ending keeps of a row's questions (cancel closes every question, ER-8): an
 * ended row whose run was parked on a stop for a person owes that run its
 * `cancelled` resume (`resumeOwed`), paid to the stop its mirror names, so the
 * mirror stays until the debt is paid. `prev` is the row before the write,
 * `next` after it. Run by every write both backings make (`applyTransition`).
 */
export function keptOnEnding(prev: Task, next: Task): Partial<Task> | undefined {
  if (isTerminalStatus(prev.status) || !isTerminalStatus(next.status)) return undefined;
  const mirror = openHolds(prev).find(isSuspensionHold);
  return mirror === undefined ? undefined : { resumeOwed: true };
}

/**
 * The mirror a row no longer needs: on a row that isn't running and owes no
 * resume, the stop it mirrored has ended or been paid. Own questions stay, the
 * record of what was asked; a closed one is closed by its answer or the row's end.
 */
export function droppedMirror(row: Task): Partial<Task> | undefined {
  if (suspensionHoldOf(row) === undefined || row.status === "in_progress" || row.resumeOwed === true) return undefined;
  return { holds: withoutMirror(row.holds) };
}

/** The own questions a touch at `at` closes "no answer came": open, with a due time passed. */
export function holdsDue(row: Pick<Task, "status" | "holds" | "steers">, at: number): OwnHold[] {
  return openOwnHolds(row).filter((hold) => hold.due !== undefined && hold.due <= at);
}

/** The earliest due time of `row`'s open own questions, or `undefined` when none has one. */
export function nextHoldDue(row: Pick<Task, "status" | "holds" | "steers">): number | undefined {
  let next: number | undefined;
  for (const hold of openOwnHolds(row)) if (hold.due !== undefined) next = next === undefined ? hold.due : Math.min(next, hold.due);
  return next;
}

// FIX-2086.
/**
 * Whether `row` owes a turn on its same attempt that the claim takes (D3): a
 * running row with no lease and no open question, marked `turnOwed` by its last
 * own question's release, or by the turn a steer no request took is owed
 * (beside its `keptOpenBy: "steer"`). The mark, not `keptOpenBy`:
 * `"steer"` is also what a later request parked after the task answered
 * leaves, with that request still to resume.
 */
export function owesTurn(row: Pick<Task, "status" | "holds" | "steers" | "leaseUntil" | "turnOwed">): boolean {
  if (row.status !== "in_progress" || row.leaseUntil != null || hasOpenHold(row)) return false;
  return row.turnOwed === true;
}
