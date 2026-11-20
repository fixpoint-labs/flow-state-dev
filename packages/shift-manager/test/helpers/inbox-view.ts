/**
 * The inbox view's answer for a fixed Lab, for screen tests that mock
 * `useInbox`: the rows (each with its board's owner label, as the server
 * names it) and the Inbox items orchestration lists over those rows and the
 * asks, each ask's detail the projection the server answers.
 */
import type { SessionSummary } from "@flow-state-dev/client";
import type { SuspendForUserKind } from "@flow-state-dev/core/types";
import { inboxItems, taskActionName } from "@flow-state-dev/orchestration/inbox";
import type { InboxAsk, InboxViewValue } from "../../src/lib/inbox";
import { CONVERSATION_BOARD_COLLECTION, conversationBoardRef, type BoardTaskView } from "../../src/lib/boards";
import { workerOf, workstreamOf } from "../../src/lib/workers";

/** An ask a fixed Lab holds: where it waits, who asked, and what it says. */
export type FixtureAsk = {
  /** The session it waits in. */
  sessionId: string;
  /** The worker that asked, when its session names one. */
  workerId: string | null;
  /** The flow that owns its session, where the answer goes. */
  flowId: string;
  suspensionId: string;
  requestId: string;
  kind: SuspendForUserKind;
  message: string;
  title?: string;
  /** When it was raised, epoch ms. */
  since: number;
};

/** What a row's board is called on a screen: the workstream its conversation leads, else `@<worker>`, else the conversation's id. */
function ownerOf(sessions: readonly SessionSummary[], row: BoardTaskView): string {
  const session = sessions.find((s) => s.id === row.ownerSessionId);
  if (session === undefined) return row.ownerSessionId;
  const workstream = workstreamOf(session);
  if (workstream !== null) return workstream;
  const worker = workerOf(session);
  return worker === null ? row.ownerSessionId : `@${worker}`;
}

/** The view's answer over `rows` and `asks`, as the server builds it. */
export function inboxViewOf(rows: readonly BoardTaskView[], asks: readonly FixtureAsk[] = [], sessions: readonly SessionSummary[] = []): InboxViewValue {
  const flows = new Map(sessions.map((session) => [session.id, session.flowId ?? null]));
  return {
    tasks: rows.map((row) => ({ ...row, owner: ownerOf(sessions, row) })),
    items: inboxItems<InboxAsk>({
      rows: rows.map((row) => ({
        ...row,
        board: row.boardRef,
        holder:
          row.boardRef === conversationBoardRef(row.ownerSessionId)
            ? { sessionId: row.ownerSessionId, action: taskActionName("updateTask", CONVERSATION_BOARD_COLLECTION) }
            : null,
      })),
      suspensions: asks.map((ask) => ({
        sessionId: ask.sessionId,
        flowId: ask.flowId,
        requestId: ask.requestId,
        suspensionId: ask.suspensionId,
        kind: ask.kind,
        prompt: ask.message,
        ...(ask.title === undefined ? {} : { title: ask.title }),
        since: ask.since,
        detail: {
          suspensionId: ask.suspensionId,
          requestId: ask.requestId,
          flowKind: ask.flowId,
          flowId: ask.flowId,
          sessionId: ask.sessionId,
          workerId: ask.workerId,
          kind: ask.kind,
          shape: "approval",
          ...(ask.title === undefined ? {} : { title: ask.title }),
          message: ask.message,
          createdAt: ask.since,
        } as InboxAsk,
      })),
      flowOf: (sessionId) => flows.get(sessionId),
    }),
  };
}
