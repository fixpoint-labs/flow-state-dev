/**
 * The Inbox: the one list of what waits on the user, and the check that it is
 * the list it should be.
 *
 * Two kinds of item wait on the user, and each is listed from one source only:
 *
 * - **a suspension** (`source: "suspension"`): a request stopped for a
 *   user's approval or input, listed from the pending asks `reads.ts` reads
 *   out of worker sessions (`readAsks`);
 * - **a held question** (`source: "question"`): a task row that holds open
 *   questions, listed from the board rows, one item per row however many
 *   questions it holds.
 *
 * {@link inboxItems} is the only function that builds the list. Every screen
 * and count that says what waits on the user reads the snapshot's `inbox`
 * section it fills, so the sidebar's count and the Inbox can't disagree. The
 * task-surface sweep (`goals/workforce-coordination/runs-on-one-task`) fails a
 * change that builds an item, or reads a row's questions or a session's
 * suspensions for a list, anywhere else.
 *
 * {@link reconcileInbox} checks a list against truth read apart from it: the
 * suspended requests a session lists (`listSessionRequests`), not its item
 * log, and the board's own task rows. A check that read the list's own sources
 * would agree with any list.
 */
import type { SessionRequestSummary } from "@flow-state-dev/client";
import type { Ask, BoardRow, HeldQuestion } from "./reads";

/** One thing waiting on the user: a suspension, or a task row's held questions. */
export type InboxItem =
  | {
      source: "suspension";
      /** The item's address in the Inbox (its route) and its key in {@link reconcileInbox}. */
      id: string;
      /** When it started waiting, epoch ms. */
      since: number;
      ask: Ask;
    }
  | {
      source: "question";
      id: string;
      since: number;
      row: BoardRow;
      /** The row's open questions, oldest first. Never empty. */
      questions: HeldQuestion[];
    };

/** A suspension item's id: its suspension id, so an Inbox link written before held questions still opens it. */
export function suspensionItemId(suspensionId: string): string {
  return suspensionId;
}

/** A held-question item's id: one per row, by its board and its task. */
export function questionItemId(boardRef: string, taskId: string): string {
  return `question:${boardRef}:${taskId}`;
}

/**
 * The Inbox list: every pending ask, and one item for every row that holds an
 * open question, oldest first. The only place an Inbox item is built.
 */
export function inboxItems(asks: readonly Ask[], rows: readonly BoardRow[]): InboxItem[] {
  const items: InboxItem[] = asks.map((ask) => ({ source: "suspension", id: suspensionItemId(ask.item.suspensionId), since: ask.since, ask }));
  for (const row of rows) {
    if (row.questions.length === 0) continue;
    items.push({
      source: "question",
      id: questionItemId(row.boardRef, row.id),
      since: Math.min(...row.questions.map((q) => q.askedAt ?? row.updatedAt ?? 0)),
      row,
      questions: row.questions,
    });
  }
  return items.sort((a, b) => a.since - b.since);
}

/** Whether `item` is an approval or a question, as the Inbox's filter reads it. A held question is a question. */
export function approvalOrQuestion(item: InboxItem): "approval" | "question" {
  return item.source === "suspension" ? item.ask.kind : "question";
}

/**
 * Why the user can't answer `item` from the Inbox, or `null` when they can,
 * through its arm's one route: a suspension through its session's owning
 * flow, a held question through its board's `updateTask`.
 */
function unanswerableReason(item: InboxItem): string | null {
  if (item.source === "suspension") return item.ask.unanswerable;
  return null;
}

// ---- the check --------------------------------------------------------------------------------

/** A suspension waiting on the user, as the session's request listing records it. */
export type SuspensionTruth = { id: string; sessionId: string; requestId: string; taskId: string | null };

/** A task row holding open questions, as the board's own task listing records it. */
export type QuestionTruth = { id: string; boardRef: string; taskId: string; open: string[] };

/**
 * A task row whose run waits on a suspension for the user: the join that ties a
 * suspension to the row it holds, so a row that maps to both arms is seen.
 */
export type WaitingRowTruth = { boardRef: string; taskId: string; sessionId: string; requestId: string };

/** What should be in the Inbox, read apart from the list. */
export type InboxTruth = {
  suspensions: readonly SuspensionTruth[];
  questions: readonly QuestionTruth[];
  waitingRows?: readonly WaitingRowTruth[];
  /**
   * Ids answered or cancelled before this read: each must be in no later
   * list, and in no later truth either.
   */
  closed?: readonly string[];
};

/** What {@link reconcileInbox} found. Green when every list is empty. */
export type InboxReconciliation = {
  green: boolean;
  /** In the truth, not in the list. */
  missing: string[];
  /** In the list more than once. */
  duplicate: string[];
  /** In the list, not in the truth. */
  orphan: string[];
  /** Rows (`<boardRef>:<taskId>`) that map to a held-question item and a suspension item at once. */
  bothArms: string[];
  /** Items the user can't answer through their arm's route, each with why. */
  unanswerable: Array<{ id: string; why: string }>;
  /** Closed ids that are back, in the list or in the truth. */
  reopened: string[];
};

/**
 * The suspensions for the user still pending in one session's suspended requests:
 * each `suspension` item with a reason `isPerson` accepts and no
 * `suspension_resume` for it in the same request. Read from the request
 * listing with its items (`listSessionRequests(id, { status: "suspended",
 * includeItems: true })`), never from the session's item log the Inbox reads.
 */
export function suspensionTruthOf(
  sessionId: string,
  requests: readonly SessionRequestSummary[],
  isPerson: (reason: string) => boolean,
): SuspensionTruth[] {
  const out: SuspensionTruth[] = [];
  for (const request of requests) {
    if (request.status !== "suspended") continue;
    const items = (request.items ?? []) as Array<{ type?: string; suspensionId?: string; reason?: string; taskId?: string }>;
    const resumed = new Set(items.filter((i) => i.type === "suspension_resume").map((i) => i.suspensionId));
    for (const item of items) {
      if (item.type !== "suspension" || typeof item.suspensionId !== "string" || resumed.has(item.suspensionId)) continue;
      if (typeof item.reason !== "string" || !isPerson(item.reason)) continue;
      out.push({ id: suspensionItemId(item.suspensionId), sessionId, requestId: request.id, taskId: item.taskId ?? null });
    }
  }
  return out;
}

/** Check `items` against `truth`. Pure: reads nothing. */
export function reconcileInbox(items: readonly InboxItem[], truth: InboxTruth): InboxReconciliation {
  const want = new Set([...truth.suspensions.map((s) => s.id), ...truth.questions.map((q) => q.id)]);
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  const listed = new Set(counts.keys());

  const missing = [...want].filter((id) => !listed.has(id));
  const duplicate = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
  const orphan = [...listed].filter((id) => !want.has(id));

  // A suspension maps to a row through the row's run (the join), or through the task it names in its session.
  const rowsOfSuspension = (item: Extract<InboxItem, { source: "suspension" }>): string[] => {
    const { sessionId, item: s } = item.ask;
    const joined = (truth.waitingRows ?? [])
      .filter((r) => r.sessionId === sessionId && r.requestId === s.requestId)
      .map((r) => `${r.boardRef}:${r.taskId}`);
    const named = items.flatMap((other) =>
      other.source === "question" && s.taskId !== undefined && other.row.id === s.taskId && other.row.run?.sessionId === sessionId
        ? [`${other.row.boardRef}:${other.row.id}`]
        : [],
    );
    return [...joined, ...named];
  };
  const questionRows = new Set(items.flatMap((i) => (i.source === "question" ? [`${i.row.boardRef}:${i.row.id}`] : [])));
  const bothArms = [
    ...new Set(items.flatMap((i) => (i.source === "suspension" ? rowsOfSuspension(i) : [])).filter((row) => questionRows.has(row))),
  ];

  const unanswerable = items.flatMap((item) => {
    const why = unanswerableReason(item);
    return why === null ? [] : [{ id: item.id, why }];
  });

  const closed = new Set(truth.closed ?? []);
  const reopened = [...new Set([...listed, ...want])].filter((id) => closed.has(id));

  return {
    green: [missing, duplicate, orphan, bothArms, unanswerable, reopened].every((list) => list.length === 0),
    missing,
    duplicate,
    orphan,
    bothArms,
    unanswerable,
    reopened,
  };
}
