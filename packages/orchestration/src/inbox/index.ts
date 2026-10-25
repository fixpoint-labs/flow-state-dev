/**
 * `@flow-state-dev/orchestration/inbox` — the Inbox: one item type over what
 * holds a task for the user, the one answer call, and the check that a list
 * is the list it should be (FIX-2133, the epic FIX-2058's Inbox read).
 *
 * **One item type.** An item is one task row's open holds for the user, or a
 * suspension for the user in a request with no task row. Each carries an
 * `answerable` flag, and the one answer call, {@link createInboxClient}'s
 * `answer`, routes by the hold's `source`: a suspension to the engine's
 * answer route (`client.flow(..).request(..).answer(..)`, FIX-2129); a row
 * hold to the board's `updateTask`, which arrives with the row holds.
 *
 * **Where an item comes from.** A task run's stop lists from its row only, never
 * from the run's session: today the row records it in `waitingFor`
 * (FIX-2129), which the row holds take over. A suspension
 * the reader found in a session lists on its own only when no row claims it.
 *
 * Browser-safe: it imports types and the client, never the task board's
 * runtime. A browser reads the rows and the sessions, a server reads
 * `listTasks`; both hand them to {@link inboxItems}, the only function that
 * builds an item (the task-surface sweep fails one built anywhere else).
 */
import type { Client, SessionRequestSummary } from "@flow-state-dev/client";
import { isUserSuspension, type ResumeAction, type WaitForUserKind } from "@flow-state-dev/core/types";

/** Where a suspension hold's answer goes: the run's flow, its request and the stop. */
export type SuspensionHoldSource = {
  readonly kind: "suspension";
  /** The flow that owns the run's session; `null` when the session names none, which leaves the hold unanswerable. */
  readonly flowId: string | null;
  readonly sessionId: string;
  readonly requestId: string;
  readonly suspensionId: string;
};

/** A hold kept on the task row itself (a question or a confirm): answered through the board. */
export type RowHoldSource = { readonly kind: "row" };

/** One open hold an item shows. */
export type InboxHold<TDetail = unknown> = {
  /** A suspension hold's suspension id; a row hold's own id. */
  readonly id: string;
  readonly source: SuspensionHoldSource | RowHoldSource;
  readonly ask: {
    readonly kind: WaitForUserKind | "question" | "confirm";
    readonly prompt: string;
    readonly title?: string;
  };
  /** When it opened, epoch ms. */
  readonly openedAt: number;
  /** When it ends unanswered, epoch ms; absent when no deadline is set. */
  readonly due?: number;
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
  /** Its address in the Inbox and its key in {@link reconcileInbox}: {@link taskItemId}, or a lone suspension's id. */
  readonly id: string;
  /** What every hold on it is, and so where its answer goes. */
  readonly source: "suspension" | "row";
  /** The task it holds; `null` for a suspension in a request with no task row. */
  readonly task: InboxTask | null;
  /** Its open holds, oldest first. Never empty. */
  readonly holds: readonly InboxHold<TDetail>[];
  /** When the oldest opened, epoch ms. */
  readonly since: number;
  /** Whether the user can answer it from the Inbox. */
  readonly answerable: boolean;
  /** Why not, when it isn't answerable; `null` when it is. */
  readonly unanswerable: string | null;
};

/** An item's id for a task row: one per row, by its board and its task. */
export function taskItemId(board: string, taskId: string): string {
  return `task:${board}:${taskId}`;
}

/** What a task row's suspension hold reads today: FIX-2129's record of the stop on the row. */
export type InboxWaitingFor = {
  readonly requestId: string;
  readonly suspensionId: string;
  readonly kind: WaitForUserKind;
  readonly prompt: string;
  readonly title?: string;
  readonly deadline?: number;
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
  readonly waitingFor?: InboxWaitingFor | null;
};

/** A suspension for the user a reader found in a session. */
export type InboxSuspension<TDetail = unknown> = {
  readonly sessionId: string;
  /** The flow that owns the session; `null` when it names none. */
  readonly flowId: string | null;
  readonly requestId: string;
  readonly suspensionId: string;
  readonly kind: WaitForUserKind;
  readonly prompt: string;
  readonly title?: string;
  /** When it was raised, epoch ms. */
  readonly since: number;
  readonly detail?: TDetail;
};

/** Why a hold in a session that names no owning flow can't be answered. */
export const NO_FLOW_UNANSWERABLE =
  "This ask can't be answered from the Inbox: its session was written before sessions recorded their owning flow, so there is no flow to answer it through.";

const TERMINAL = new Set(["completed", "errored", "cancelled"]);

/**
 * A row's open holds for the user. Until the row holds land, the one a row can
 * carry is a task run's stop, as FIX-2129 records it in `waitingFor`, on a
 * running row. Not `waitingOn`: a notice's or a steer's turn admitted while
 * the stop waits clears it and keeps `waitingFor` (`keepWaitingFor`), and
 * the stop still waits on the user.
 */
export function openUserHolds<TDetail>(
  row: InboxRow,
  flowOf: (sessionId: string) => string | null | undefined,
  foundFor: (suspensionId: string) => InboxSuspension<TDetail> | undefined = () => undefined,
): InboxHold<TDetail>[] {
  const stop = row.waitingFor;
  if (row.status !== "in_progress" || stop == null || row.run == null) return [];
  const found = foundFor(stop.suspensionId);
  const detail = found?.detail;
  // The run's flow: as its session names it, else as the reader found it where the stop is.
  const flowId = flowOf(row.run.sessionId) ?? found?.flowId ?? null;
  return [
    {
      id: stop.suspensionId,
      source: { kind: "suspension", flowId, sessionId: row.run.sessionId, requestId: stop.requestId, suspensionId: stop.suspensionId },
      ask: { kind: stop.kind, prompt: stop.prompt, ...(stop.title !== undefined ? { title: stop.title } : {}) },
      // When it was raised: the stop's own time, which a later turn on the row doesn't move; the row's only without one.
      openedAt: found?.since ?? row.updatedAt ?? 0,
      ...(stop.deadline !== undefined ? { due: stop.deadline } : {}),
      ...(detail !== undefined ? { detail } : {}),
    },
  ];
}

/** Why `hold` can't be answered from the Inbox, or `null` when it can. */
function unanswerableHold(hold: InboxHold<unknown>): string | null {
  if (hold.source.kind === "suspension") return hold.source.flowId === null ? NO_FLOW_UNANSWERABLE : null;
  return ROW_HOLD_UNANSWERABLE;
}

/** Why a row hold can't be answered yet: its answer path, the board's `updateTask`, lands with the row holds. */
export const ROW_HOLD_UNANSWERABLE = "Answering a task's question from the Inbox arrives with the row holds.";

function itemOf<TDetail>(id: string, task: InboxTask | null, holds: InboxHold<TDetail>[]): InboxItem<TDetail> {
  const sorted = [...holds].sort((a, b) => a.openedAt - b.openedAt);
  const why = sorted.map(unanswerableHold).find((reason) => reason !== null) ?? null;
  return {
    id,
    source: sorted[0]!.source.kind,
    task,
    holds: sorted,
    since: sorted[0]!.openedAt,
    answerable: why === null,
    unanswerable: why,
  };
}

/**
 * The Inbox list: one item per task row that holds the user, and one per
 * suspension a reader found that no row claims, oldest first. The only
 * function that builds an Inbox item.
 *
 * A suspension is claimed by a row when the row's hold names it, or when it
 * stopped the request the row's open run is: a task run's stop lists from its
 * row alone, so it shows once. `flowOf` names the flow that owns a session,
 * where a row's run is.
 */
export function inboxItems<TDetail = unknown>(input: {
  readonly rows: readonly InboxRow[];
  readonly suspensions: readonly InboxSuspension<TDetail>[];
  readonly flowOf: (sessionId: string) => string | null | undefined;
}): InboxItem<TDetail>[] {
  const found = new Map(input.suspensions.map((s) => [s.suspensionId, s]));
  const items: InboxItem<TDetail>[] = [];
  const claimed = new Set<string>();
  const runRequests = new Set<string>();
  for (const row of input.rows) {
    if (!TERMINAL.has(row.status) && row.run != null) runRequests.add(row.run.requestId);
    const holds = openUserHolds<TDetail>(row, input.flowOf, (id) => found.get(id));
    if (holds.length === 0) continue;
    for (const hold of holds) claimed.add(hold.id);
    const task = { board: row.board, taskId: row.id, title: row.title ?? row.goal ?? row.id, assignee: row.assignee ?? null };
    items.push(itemOf(taskItemId(row.board, row.id), task, holds));
  }
  for (const s of input.suspensions) {
    if (claimed.has(s.suspensionId) || runRequests.has(s.requestId)) continue;
    const hold: InboxHold<TDetail> = {
      id: s.suspensionId,
      source: { kind: "suspension", flowId: s.flowId, sessionId: s.sessionId, requestId: s.requestId, suspensionId: s.suspensionId },
      ask: { kind: s.kind, prompt: s.prompt, ...(s.title !== undefined ? { title: s.title } : {}) },
      openedAt: s.since,
      ...(s.detail !== undefined ? { detail: s.detail } : {}),
    };
    items.push(itemOf(s.suspensionId, null, [hold]));
  }
  return items.sort((a, b) => a.since - b.since);
}

// ---- the answer -----------------------------------------------------------------------------

/** What the user answers a hold with. */
export type InboxAnswer = { readonly action: ResumeAction; readonly data?: unknown };

/** Answer one suspension hold through the engine's answer route, which sets who answered. */
export async function answerSuspension(client: Client, source: SuspensionHoldSource, answer: InboxAnswer): Promise<void> {
  if (source.flowId === null) throw new Error(NO_FLOW_UNANSWERABLE);
  await client.flow(source.flowId).request(source.requestId).answer({
    suspensionId: source.suspensionId,
    action: answer.action,
    ...(answer.data === undefined ? {} : { data: answer.data }),
  });
}

/** The Inbox's browser client: its one answer call. */
export type InboxClient = {
  /**
   * Answer `item`'s hold `holdId` (its first when omitted), routed by its
   * source. Rejects when the item isn't answerable, or when the route refuses.
   */
  answer(item: InboxItem<unknown>, answer: InboxAnswer, holdId?: string): Promise<void>;
};

/** The Inbox's client over one connection. */
export function createInboxClient(client: Client): InboxClient {
  return {
    async answer(item, answer, holdId) {
      const hold = holdId === undefined ? item.holds[0] : item.holds.find((h) => h.id === holdId);
      if (hold === undefined) throw new Error(`Inbox item "${item.id}" holds no "${holdId}"`);
      const why = unanswerableHold(hold);
      if (why !== null) throw new Error(why);
      if (hold.source.kind === "suspension") return answerSuspension(client, hold.source, answer);
      throw new Error(ROW_HOLD_UNANSWERABLE);
    },
  };
}

// ---- the check ------------------------------------------------------------------------------

/** A suspension for the user, as a session's request listing records it. */
export type SuspensionTruth = {
  readonly suspensionId: string;
  readonly sessionId: string;
  readonly requestId: string;
  /** Whether its request is a task's run (source `task`): its stop lists from that task's row. */
  readonly taskRun: boolean;
};

/** A task row's open user holds, as the board's own task listing records them. */
export type RowTruth = {
  readonly board: string;
  readonly taskId: string;
  /** The suspension ids of its open suspension holds. */
  readonly suspensionHolds: readonly string[];
};

/** What should be in the Inbox, read apart from the list. */
export type InboxTruth = {
  readonly suspensions: readonly SuspensionTruth[];
  readonly rows: readonly RowTruth[];
  /** Ids answered or cancelled before this read: each must be in no later list, and no later truth. */
  readonly closed?: readonly string[];
};

/** What {@link reconcileInbox} found. Green when every list is empty. */
export type InboxReconciliation = {
  readonly green: boolean;
  /** In the truth, not in the list. */
  readonly missing: string[];
  /** In the list more than once. */
  readonly duplicate: string[];
  /** In the list, not in the truth. */
  readonly orphan: string[];
  /**
   * A task run's stop and its row's hold disagree: a stop with no hold or
   * more than one, or a hold whose stop is no longer live.
   */
  readonly drift: string[];
  /** Items the user can't answer, each with why. */
  readonly unanswerable: Array<{ id: string; why: string }>;
  /** Closed ids that are back, in the list or in the truth. */
  readonly reopened: string[];
};

/**
 * The suspensions for the user still pending in one session's suspended
 * requests: each `suspension` item `isUserSuspension` accepts with no
 * `suspension_resume` for it in the same request. Read from the request
 * listing with its items (`client.sessions.requests(id, { status:
 * "suspended", includeItems: true })`), never the session item log an Inbox
 * reader lists from.
 */
export function suspensionTruthOf(sessionId: string, requests: readonly SessionRequestSummary[]): SuspensionTruth[] {
  const out: SuspensionTruth[] = [];
  for (const request of requests) {
    if (request.status !== "suspended") continue;
    const items = (request.items ?? []) as Array<{ type?: string; suspensionId?: string; reason?: string }>;
    const resumed = new Set(items.filter((i) => i.type === "suspension_resume").map((i) => i.suspensionId));
    for (const item of items) {
      if (item.type !== "suspension" || typeof item.suspensionId !== "string" || resumed.has(item.suspensionId)) continue;
      if (typeof item.reason !== "string" || !isUserSuspension({ reason: item.reason })) continue;
      out.push({ suspensionId: item.suspensionId, sessionId, requestId: request.id, taskRun: request.source === "task" });
    }
  }
  return out;
}

/** A board's rows as truth: each row's open suspension holds, from what `listTasks` returns. */
export function rowTruthOf(rows: readonly InboxRow[]): RowTruth[] {
  return rows.flatMap((row) => {
    const holds = openUserHolds(row, () => "truth").map((h) => h.id);
    return holds.length === 0 ? [] : [{ board: row.board, taskId: row.id, suspensionHolds: holds }];
  });
}

/** Check `items` against `truth`. Pure: reads nothing. */
export function reconcileInbox(items: readonly InboxItem<unknown>[], truth: InboxTruth): InboxReconciliation {
  const want = new Set([
    ...truth.rows.map((r) => taskItemId(r.board, r.taskId)),
    ...truth.suspensions.filter((s) => !s.taskRun).map((s) => s.suspensionId),
  ]);
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  const listed = new Set(counts.keys());

  const missing = [...want].filter((id) => !listed.has(id));
  const duplicate = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
  const orphan = [...listed].filter((id) => !want.has(id));

  const drift: string[] = [];
  const live = new Set(truth.suspensions.map((s) => s.suspensionId));
  for (const stop of truth.suspensions.filter((s) => s.taskRun)) {
    const holders = truth.rows.filter((r) => r.suspensionHolds.includes(stop.suspensionId));
    if (holders.length !== 1) drift.push(`stop ${stop.suspensionId}: ${holders.length} open holds`);
  }
  for (const row of truth.rows) {
    for (const id of row.suspensionHolds) if (!live.has(id)) drift.push(`hold ${id} on ${row.board}:${row.taskId}: no live stop`);
  }
  // A listed task item shows the holds its row holds now: a stale list offers a stop that ended.
  const heldBy = new Map(truth.rows.map((r) => [taskItemId(r.board, r.taskId), [...r.suspensionHolds].sort()]));
  for (const item of items) {
    const held = heldBy.get(item.id);
    if (item.task === null || held === undefined) continue;
    const shown = item.holds.filter((h) => h.source.kind === "suspension").map((h) => h.id).sort();
    if (shown.join(",") !== held.join(",")) drift.push(`item ${item.id} shows ${shown.join(", ") || "none"}, its row holds ${held.join(", ") || "none"}`);
  }

  const unanswerable = items.flatMap((item) => (item.unanswerable === null ? [] : [{ id: item.id, why: item.unanswerable }]));
  const closed = new Set(truth.closed ?? []);
  const reopened = [...new Set([...listed, ...want])].filter((id) => closed.has(id));

  return {
    green: [missing, duplicate, orphan, drift, unanswerable, reopened].every((list) => list.length === 0),
    missing,
    duplicate,
    orphan,
    drift,
    unanswerable,
    reopened,
  };
}
