/**
 * What the snapshot's reads compute from one snapshot. No screen reads the
 * snapshot any more: the screens compute from their own reads (`shift.ts`,
 * `inbox.ts`), and the helpers both share live there.
 */
import type { InboxItem } from "@flow-state-dev/orchestration/inbox";
import { isDone } from "./columns";
import type { Ask, LabSnapshot } from "./reads";
import type { BoardTaskView } from "./boards";
import type { Failure, Section } from "./failure";
import type { Project } from "./project";
import { workerOf, workstreamOf } from "./workers";

/** A loaded snapshot (not a refusal, not an unreachable Lab). */
export type LoadedSnapshot = Exclude<LabSnapshot, { refused: Failure } | { unreachable: Failure }>;

/** Every task on every board that loaded, across conversations. */
export function allTasks(snapshot: LoadedSnapshot): BoardTaskView[] {
  return Object.values(snapshot.boards).flatMap((boards) => (boards.ok ? boards.value.rows : []));
}

// BR-40.
/**
 * What a row's board is called on a screen: the workstream the conversation
 * that holds it leads (its `workstreamId`), so one worker's two workstreams
 * are two boards; else the worker the conversation is with
 * (`@<worker>`); else the conversation's id.
 */
export function boardOwnerOf(snapshot: LoadedSnapshot, row: BoardTaskView): string {
  const session = snapshot.sessions.find((s) => s.id === row.ownerSessionId);
  if (session === undefined) return row.ownerSessionId;
  const workstream = workstreamOf(session);
  if (workstream !== null) return workstream;
  const worker = workerOf(session);
  return worker === null ? row.ownerSessionId : `@${worker}`;
}

// BR-15.
/** The tasks Tasks shows: every attached board's, excluding done ones. */
export function openTasks(snapshot: LoadedSnapshot): BoardTaskView[] {
  return allTasks(snapshot).filter((row) => !isDone(row.status));
}

/**
 * The Inbox item that shows suspension `suspensionId`: a task's item when its
 * task holds it, else the ask's own. Its id when the Inbox didn't load or
 * doesn't list it, so a link still opens the Inbox.
 */
export function inboxItemIdOf(snapshot: LoadedSnapshot, suspensionId: string): string {
  const items = snapshot.inbox.ok ? snapshot.inbox.value : [];
  return items.find((item) => item.holds.some((hold) => hold.id === suspensionId))?.id ?? suspensionId;
}

/**
 * The Inbox item a route names: by its id, else, for a link written when an
 * item's id was its suspension's (`/inbox/<suspensionId>`), the item one of
 * whose holds that suspension is. `null` when none.
 */
export function inboxItemAt(snapshot: LoadedSnapshot, id: string | null): InboxItem<Ask> | null {
  if (id === null) return null;
  const items = snapshot.inbox.ok ? snapshot.inbox.value : [];
  return items.find((item) => item.id === id) ?? items.find((item) => item.holds.some((hold) => hold.id === id)) ?? null;
}

// FIX-2131.
/**
 * Whether a task holds on a question or confirm for you: its Inbox
 * item has a hold the board keeps on the row. A task waiting on its run's stop
 * for you (an approval, a review) shows that stop as an ask instead
 * ({@link asksOfTask}). `false` while the snapshot or its Inbox isn't read.
 */
export function waitsOnYou(snapshot: LabSnapshot | undefined, row: Pick<BoardTaskView, "boardRef" | "id"> | undefined): boolean {
  if (snapshot === undefined || snapshot.refused !== undefined || snapshot.unreachable !== undefined || row === undefined || !snapshot.inbox.ok) return false;
  return snapshot.inbox.value.some(
    (item) => item.task?.board === row.boardRef && item.task.taskId === row.id && item.holds.some((hold) => hold.source.kind === "task"),
  );
}

// BR-17.
/**
 * The pending asks a task's run waits on: those in the session its
 * row's run link names, stamped with this task, or unstamped and raised by
 * the very request the link names. Empty while the snapshot or its asks
 * aren't read.
 */
export function asksOfTask(snapshot: LabSnapshot | undefined, row: Pick<BoardTaskView, "id" | "run"> | undefined): Ask[] {
  if (snapshot === undefined || snapshot.refused !== undefined || snapshot.unreachable !== undefined || !snapshot.asks.ok || row?.run == null) return [];
  const { sessionId, requestId } = row.run;
  return snapshot.asks.value.filter(
    (ask) =>
      ask.sessionId === sessionId && (ask.item.taskId === row.id || (ask.item.taskId === undefined && ask.item.requestId === requestId)),
  );
}

/** PROJECTS: every project the user reads. */
export type ProjectsView = { projects: Project[] };

// BR-22.
/**
 * PROJECTS: every project the user reads, shared ones and their own
 * private ones. Derived from the snapshot alone: no read of its own. Fails when
 * the projects read did.
 */
export function projectsOf(snapshot: LoadedSnapshot): Section<ProjectsView> {
  if (!snapshot.projects.ok) return snapshot.projects;
  return { ok: true, value: { projects: snapshot.projects.value.rows } };
}

/** Whether a row is running. */
const isRunning = (row: BoardTaskView) => row.status === "in_progress";

/** The first failed board read, if any. */
function boardFailure(snapshot: LoadedSnapshot): Failure | undefined {
  for (const boards of Object.values(snapshot.boards)) if (!boards.ok) return boards.failure;
  return undefined;
}

// D1, BR-4; FIX-2131; BR-8.
/**
 * The shift summary's numbers: what waits on the user, as Inbox
 * lists it (one item per task held on a question, a review or an approval,
 * and per ask no task holds); the asks the worker sessions hold,
 * each drawn as a card; and the runs going with how many workstreams they run
 * in, from the rows Tasks reads. Each line fails on its own read.
 */
export function shiftSummary(snapshot: LoadedSnapshot): {
  inbox: Section<InboxItem<Ask>[]>;
  asks: Section<Ask[]>;
  running: Section<{ runs: number; workstreams: number }>;
} {
  const boardsFailed = boardFailure(snapshot);
  const failed = snapshot.inventory.ok ? boardsFailed : snapshot.inventory.failure;
  const running = openTasks(snapshot).filter(isRunning);
  return {
    inbox: snapshot.inbox,
    asks: snapshot.asks,
    running:
      failed === undefined
        ? { ok: true, value: { runs: running.length, workstreams: new Set(running.map((row) => row.ownerSessionId)).size } }
        : { ok: false, failure: failed },
  };
}
