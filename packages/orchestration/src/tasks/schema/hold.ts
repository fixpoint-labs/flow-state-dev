/**
 * What holds a task on its row (FIX-2133 D2, the epic FIX-2058's ER-8): one
 * list of holds, `Task.holds`, whatever the row's status.
 *
 * Two sources, discriminated on `source.kind`:
 *
 * - **`"suspension"`**: the mirror of a task run's parked `suspendForUser` stop.
 *   The claim gate's stop arm opens it in the write that drops the lease, and
 *   the write that admits the run's resume closes it. After a cancel it stays,
 *   with its address, until the `cancelled` resume it owes (`resumeOwed`) is
 *   paid. Answered through the engine's answer route (FIX-2129).
 * - **`"row"`**: a question or a `confirm`, with nothing parked. It is open
 *   while no steer carries its id (`TaskSteer.answers`), so "answered" is never
 *   stored twice. Released by its first releaser: in this epic only an answer,
 *   a steer from the user carrying its id, or the board's "no answer came"
 *   steer at a deadline a host set. Or an **`external`** wait (FIX-2578):
 *   `actor: "system"`, the running turn waiting on something outside the
 *   board, one `{ by: "event" }` releaser per thing it waits on. It is
 *   released the same way, by any steer that answers it (a person's line, a
 *   delivered message), and never by the Inbox, which lists only `"user"`
 *   holds.
 *
 * Server-written only, through the collection's one hold write
 * (`../collection/holds`); no caller patch reaches it. `actor` and
 * `closedBy` are stored from the first write, so a later kind needs no
 * migration.
 */
import { z } from "zod";

/** The most characters of a hold's prompt a row keeps: a list of tasks stays small (BP-042). */
export const MAX_QUESTION_PROMPT = 1_000;

/** Who a hold waits on: the Inbox lists `"user"` holds; an `external` wait is the `"system"`'s. */
const holdActorSchema = z.enum(["user", "system"]);

/**
 * What releases a row hold: an `answer` (a question or a confirm), or an
 * `event` naming one thing an `external` wait waits on, by its `key`. Either
 * way the hold closes when a steer carries its id.
 */
const releaserSchema = z.union([
  z.object({ by: z.literal("answer") }),
  z.object({ by: z.literal("event"), event: z.string(), key: z.string() }),
]);

const holdBase = {
  /** Unique on its row. A suspension hold's is its suspension's id; a row hold's is minted when it opens. */
  id: z.string(),
  actor: holdActorSchema,
  /** When it opened, epoch ms. */
  openedAt: z.number(),
  /** When it ends unanswered, epoch ms. **Absent** when no deadline is set: it waits until answered or cancelled. */
  due: z.number().optional(),
};

/** A task run's parked stop for a person, mirrored on its row. */
export const suspensionHoldSchema = z.object({
  ...holdBase,
  /**
   * The stop's address: the run's request and its suspension. The flow its
   * answer goes through is the one that owns the session the row's run link
   * names, read there.
   */
  source: z.object({ kind: z.literal("suspension"), requestId: z.string(), suspensionId: z.string() }),
  ask: z.object({
    kind: z.enum(["approval", "review", "input"]),
    prompt: z.string(),
    title: z.string().optional(),
  }),
});

/** A question, a confirm or an external wait, kept on the row itself. */
export const rowHoldSchema = z.object({
  ...holdBase,
  source: z.object({ kind: z.literal("row"), closedBy: z.array(releaserSchema) }),
  ask: z.object({
    /** `question` and `confirm` wait on a person; `external` (FIX-2578, `actor: "system"`) on something outside the board. */
    kind: z.enum(["question", "confirm", "external"]),
    prompt: z.string(),
    title: z.string().optional(),
    /**
     * A confirm's No (owner, 2026-10-25): `"cancel"` cancels the task, the
     * No and its note kept as the cancel's reason; `"continue"` lets the work
     * go on with "No." in its brief. Written on every confirm from its first
     * write, `"cancel"` unless its filer said otherwise. **Absent** on a
     * question.
     */
    onNo: z.enum(["cancel", "continue"]).optional(),
  }),
  /**
   * Asked midway, by the turn holding the task's claim, rather than at
   * filing. Only a midway question may be answered by the filer's own tool
   * (ER-4); every other row hold is the user's.
   */
  midway: z.literal(true).optional(),
});

/** One hold on a task row. */
export const taskHoldSchema = z.union([suspensionHoldSchema, rowHoldSchema]);

export type SuspensionHold = z.infer<typeof suspensionHoldSchema>;
export type RowHold = z.infer<typeof rowHoldSchema>;
export type TaskHold = z.infer<typeof taskHoldSchema>;

/** What a confirm's No does: cancel the task (the default), or let the work go on. */
export type ConfirmOnNo = "cancel" | "continue";

/** One thing an external wait waits on: what kind of event (`"pull-request"`), and which one (`key`). */
export interface ExternalWaitEvent {
  readonly event: string;
  readonly key: string;
}

/**
 * What the turn holding a task's claim waits on outside the board (FIX-2578):
 * a line a screen can show (`prompt`), and the events that end the wait.
 */
export interface ExternalWait {
  readonly prompt: string;
  readonly title?: string;
  readonly events: readonly ExternalWaitEvent[];
}

/** What a filer or a worker asks: a question's words, or a `confirm` with what its No does. */
export type QuestionInit = { readonly kind: "question" | "confirm"; readonly prompt: string; readonly title?: string; readonly onNo?: ConfirmOnNo };
