/**
 * How Inbox reads its items: which item a route opens, how the list groups
 * them, and the session and worker a stop belongs to. Pure functions over the
 * inbox view's items, with no React, so a check reads Inbox exactly as the
 * screen does.
 */
import type { InboxHold, InboxItem } from "@flow-state-dev/orchestration/inbox";
import type { InboxSuspensionDetail as InboxAsk } from "@flow-state-dev/workforce/browser";

/** An Inbox item, each suspension hold carrying its ask's detail. */
type InboxViewItem = InboxItem<InboxAsk>;
/** One hold of an Inbox item. */
type InboxViewHold = InboxHold<InboxAsk>;

/**
 * The Inbox item a route names: by its id; else the item one of whose holds
 * it names (a stop's hold id, `suspensionHoldId`); else, for a link written before its ask
 * existed (`/inbox/<sessionId>`, an error report's), the lone ask waiting in
 * that session. Only the user's own items are searched, so any other id,
 * another user's session included, is `null`, as an unknown one is.
 */
export function itemAtRoute(items: readonly InboxViewItem[], id: string | null): InboxViewItem | null {
  if (id === null) return null;
  return (
    items.find((item) => item.id === id) ??
    items.find((item) => item.holds.some((hold) => hold.id === id)) ??
    items.find((item) => item.task === null && item.holds.some((hold) => sessionOfHold(hold) === id)) ??
    null
  );
}

/** One entry of the list: a task's item (or an ask no worker is named for) on its own, or a worker's lone asks together. */
type InboxListEntry = { kind: "item"; item: InboxViewItem } | { kind: "group"; worker: string; items: InboxViewItem[] };

/**
 * `items` as Inbox's list draws them: every ask no task holds, grouped under the
 * worker that raised it, the group where its oldest ask stands; a task's item,
 * and an ask that names no worker, on its own.
 */
export function groupedByWorker(items: readonly InboxViewItem[]): InboxListEntry[] {
  const entries: InboxListEntry[] = [];
  const groups = new Map<string, InboxViewItem[]>();
  for (const item of items) {
    const worker = item.task === null ? workerOfHold(item.holds[0]!) : null;
    if (worker === null) {
      entries.push({ kind: "item", item });
      continue;
    }
    const group = groups.get(worker);
    if (group !== undefined) group.push(item);
    else {
      const started: InboxViewItem[] = [item];
      groups.set(worker, started);
      entries.push({ kind: "group", worker, items: started });
    }
  }
  return entries;
}

/** The session a stop waits in, or `null` for a run with no conversation (or a task's own hold). */
export function sessionOfHold(hold: InboxViewHold): string | null {
  return hold.source.kind === "suspension" ? hold.source.sessionId : null;
}

/** The suspension a stop is, as its request names it; `undefined` for a task's own hold. */
export function suspensionIdOfHold(hold: InboxViewHold): string | undefined {
  return hold.source.kind === "suspension" ? hold.source.suspensionId : undefined;
}

/** The worker a stop asks for: its ask's, when its session names one. */
export function workerOfHold(hold: InboxViewHold): string | null {
  return hold.detail?.workerId ?? null;
}
