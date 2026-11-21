/**
 * The inbox view's answer for a fixture snapshot, for screen tests that swap
 * the Lab's reader for a fixed snapshot: the same rows (each with its board
 * owner's label) and the same Inbox items, each ask's detail the projection
 * the server answers. A screen test mocks `useInbox` to answer this, so the
 * screens that read the view draw what the snapshot holds.
 */
import { suspendForUserKindOf } from "@flow-state-dev/core/types";
import { boardOwnerOf, type LoadedSnapshot } from "../../src/lib/derive";
import type { InboxAsk, InboxViewValue } from "../../src/lib/inbox";
import type { Ask, LabSnapshot } from "../../src/lib/reads";
import type { Section } from "../../src/lib/failure";

/** An ask as the view's detail carries it. */
function askOf(ask: Ask): InboxAsk {
  return {
    suspensionId: ask.item.suspensionId,
    requestId: ask.item.requestId,
    flowKind: ask.flowId ?? "worker",
    ...(ask.flowId !== null ? { flowId: ask.flowId } : {}),
    sessionId: ask.sessionId,
    workerId: ask.workerId,
    kind: suspendForUserKindOf(ask.item) ?? "input",
    shape: "approval",
    ...(ask.item.title !== undefined ? { title: ask.item.title } : {}),
    message: ask.item.message,
    ...(ask.item.allow !== undefined ? { allow: ask.item.allow } : {}),
    ...(ask.item.resumeSchema !== undefined ? { resumeSchema: ask.item.resumeSchema } : {}),
    createdAt: ask.since,
  } as InboxAsk;
}

/** The view's section for `snapshot`: its failure where the snapshot's Inbox failed, else its rows and items. */
export function viewOfSnapshot(snapshot: LabSnapshot | undefined): Section<InboxViewValue> | undefined {
  if (snapshot === undefined) return undefined;
  if (snapshot.refused !== undefined) return { ok: false, failure: snapshot.refused };
  if (snapshot.unreachable !== undefined) return { ok: false, failure: snapshot.unreachable };
  const loaded = snapshot as LoadedSnapshot;
  if (!loaded.inbox.ok) return { ok: false, failure: loaded.inbox.failure };
  const tasks = Object.values(loaded.boards).flatMap((board) => (board.ok ? board.value.rows.map((task) => ({ ...task, owner: boardOwnerOf(loaded, task) })) : []));
  const items = loaded.inbox.value.map((item) => ({
    ...item,
    holds: item.holds.map(({ detail, ...hold }) => (detail === undefined ? hold : { ...hold, detail: askOf(detail) })),
  }));
  return { ok: true, value: { items, tasks } };
}
