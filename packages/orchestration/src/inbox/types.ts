/**
 * The Inbox's shapes: one item type over what holds a task for the user, its
 * holds, what a read hands the list, and the answer a hold takes (FIX-2133).
 * `index.ts` publishes the ones a caller uses; the rest stay inside the read.
 */
import type { SuspendForUserKind } from "@flow-state-dev/core/types";
import type { TaskHold } from "../tasks/schema/hold";

/** What a hold asks the user for: a task run's stop (`approval`, `review`, `input`) or a row's own (`question`, `confirm`). */
export type InboxAskKind = SuspendForUserKind | "question" | "confirm";

/** Where a suspension hold's answer goes: the run's flow, its request and the stop. */
export type SuspensionHoldSource = {
  readonly kind: "suspension";
  /** The flow that owns the run's session; `null` when the session names none, which leaves the hold unanswerable. */
  readonly flowId: string | null;
  readonly sessionId: string;
  readonly requestId: string;
  readonly suspensionId: string;
};

/**
 * A hold kept on the task row itself (a question or a confirm): answered
 * through the board's `updateTask` action, as the user, on the session that
 * holds the board.
 */
export type RowHoldSource = {
  readonly kind: "row";
  /** The flow that owns the board's session; `null` when the reader can't name it, which leaves the hold unanswerable. */
  readonly flowId: string | null;
  /** The session that holds the board; `null` when the row names none. */
  readonly sessionId: string | null;
  /** The board's `updateTask` action on that session. */
  readonly action: string | null;
  /** The task the hold is on. */
  readonly taskId: string;
};

/** One open hold an item shows. */
export type InboxHold<TDetail = unknown> = {
  /** A suspension hold's suspension id; a row hold's own id. */
  readonly id: string;
  /** What answers it: a suspension through the engine, a row hold through the board. */
  readonly source: SuspensionHoldSource | RowHoldSource;
  readonly ask: { readonly kind: InboxAskKind; readonly prompt: string; readonly title?: string };
  /** When it opened, epoch ms. */
  readonly openedAt: number;
  /** When it ends unanswered, epoch ms; absent when no deadline is set. */
  readonly due?: number;
  /** Whether the user can answer it from the Inbox. */
  readonly answerable: boolean;
  /** Why not, when it isn't answerable; `null` when it is. */
  readonly unanswerable: string | null;
  /** What the reader found for it beside the row (for a suspension, its pending item), to draw it with. */
  readonly detail?: TDetail;
};

/** The task an item is about. */
export type InboxTask = {
  /** The board's ref the row is on. */
  readonly board: string;
  readonly taskId: string;
  readonly title: string;
  readonly assignee: string | null;
};

/** One thing waiting on the user. */
export type InboxItem<TDetail = unknown> = {
  /** Its address in the Inbox: a task's item by its board and task, else a lone suspension's id. */
  readonly id: string;
  /** The task it holds; `null` for a suspension in a request with no task row. */
  readonly task: InboxTask | null;
  /** Its open holds, oldest first. Never empty. Each says where its own answer goes. */
  readonly holds: readonly InboxHold<TDetail>[];
  /** When the oldest opened, epoch ms. */
  readonly since: number;
  /** Whether the user can answer any of its holds from the Inbox. */
  readonly answerable: boolean;
  /** Why not, when none of its holds is answerable; `null` when one is. */
  readonly unanswerable: string | null;
};

/** A task row, as much of it as the Inbox reads. A browser's board row and a server's `Task` both fit. */
export type InboxRow = {
  /** The board's ref the row is on. */
  readonly board: string;
  readonly id: string;
  readonly title?: string | null;
  readonly goal?: string | null;
  readonly assignee?: string | null;
  readonly status: string;
  readonly updatedAt?: number | null;
  /** The run working it: the session and request its stop is in. */
  readonly run?: { readonly sessionId: string; readonly requestId: string } | null;
  /** What holds it (`Task.questions`): its questions and confirms, and its run's stop for a person. */
  readonly holds?: readonly TaskHold[] | null;
  /** Its steers, as far as the Inbox reads them: which hold each answers. A question is open while none carries its id. */
  readonly steers?: readonly { readonly id: string; readonly answers?: string }[] | null;
  /**
   * Where its row questions are answered: the session that holds the board, and
   * the board's `updateTask` action there. `null` when the reader can't say,
   * which leaves them unanswerable.
   */
  readonly holder?: { readonly sessionId: string; readonly action: string } | null;
};

/** A suspension for the user a reader found in a session. */
export type InboxSuspension<TDetail = unknown> = {
  readonly sessionId: string;
  /** The flow that owns the session; `null` when it names none. */
  readonly flowId: string | null;
  readonly requestId: string;
  readonly suspensionId: string;
  readonly kind: SuspendForUserKind;
  readonly prompt: string;
  readonly title?: string;
  /** When it was raised, epoch ms. */
  readonly since: number;
  readonly detail?: TDetail;
};

/** The answer each kind of hold takes. */
export type InboxAnswerFor = {
  /** A yes or a no, with what the approval's form carries. */
  readonly approval: { readonly approved: boolean; readonly data?: unknown };
  /** What the user gave, or that they skipped an optional one. */
  readonly input: { readonly value: unknown } | { readonly skipped: true };
  /** The user's verdict, or that they skipped an optional one. */
  readonly review: { readonly value: unknown } | { readonly skipped: true };
  /** The user's words. */
  readonly question: { readonly text: string };
  /** Whether the user gives the go, with a note. */
  readonly confirm: { readonly done: boolean; readonly note?: string };
};

/** The answer a hold of kind `K` takes. */
export type InboxAnswer<K extends InboxAskKind = InboxAskKind> = InboxAnswerFor[K];
