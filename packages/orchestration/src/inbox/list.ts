/**
 * The Inbox list: the only place an Inbox item is built (the task-surface
 * sweep fails one built anywhere else).
 */
import { holdOfSuspension, isOpenRow, openUserHolds, taskItemId } from "./holds";
import type { InboxHold, InboxItem, InboxRow, InboxSuspension, InboxTask } from "./types";

/** An item over `holds`, oldest first, answerable when any hold is. */
function itemOf<TDetail>(id: string, task: InboxTask | null, holds: readonly InboxHold<TDetail>[]): InboxItem<TDetail> {
  const sorted = [...holds].sort((a, b) => a.openedAt - b.openedAt);
  const answerable = sorted.some((hold) => hold.answerable);
  return {
    id,
    task,
    holds: sorted,
    since: sorted[0]!.openedAt,
    answerable,
    unanswerable: answerable ? null : (sorted.find((hold) => hold.unanswerable !== null)?.unanswerable ?? null),
  };
}

/**
 * The Inbox list: one item per task row that holds the user, and one per
 * suspension a reader found that no row claims, oldest first.
 *
 * A task run's stop lists under its row, never on its own: one the row's hold
 * names, and one in the request the row's open run is even when the row
 * records no hold for it yet (before the stop arm's write, or a record it
 * couldn't read). That one is the found suspension's own hold, still
 * answerable; the check reports the row's missing record as drift. `flowOf`
 * names the flow that owns a session, where a row's run is.
 */
export function inboxItems<TDetail = unknown>(input: {
  readonly rows: readonly InboxRow[];
  readonly suspensions: readonly InboxSuspension<TDetail>[];
  readonly flowOf: (sessionId: string) => string | null | undefined;
}): InboxItem<TDetail>[] {
  const found = new Map(input.suspensions.map((s) => [s.suspensionId, s]));
  const byRow = new Map<InboxRow, InboxHold<TDetail>[]>();
  const claimed = new Set<string>();
  const runOwner = new Map<string, InboxRow>();
  for (const row of input.rows) {
    if (isOpenRow(row) && row.run != null) runOwner.set(row.run.requestId, row);
    const holds = openUserHolds<TDetail>(row, input.flowOf, (id) => found.get(id));
    for (const hold of holds) claimed.add(hold.id);
    if (holds.length > 0) byRow.set(row, holds);
  }
  const lone: InboxItem<TDetail>[] = [];
  for (const s of input.suspensions) {
    if (claimed.has(s.suspensionId)) continue;
    const owner = runOwner.get(s.requestId);
    if (owner === undefined) {
      lone.push(itemOf(s.suspensionId, null, [holdOfSuspension(s)]));
      continue;
    }
    byRow.set(owner, [...(byRow.get(owner) ?? []), holdOfSuspension(s)]);
  }
  const items = [...byRow].map(([row, holds]) =>
    itemOf(taskItemId(row.board, row.id), { board: row.board, taskId: row.id, title: row.title ?? row.goal ?? row.id, assignee: row.assignee ?? null }, holds),
  );
  return [...items, ...lone].sort((a, b) => a.since - b.since);
}
