/**
 * The engine's half of the board-notice seam: a task board's
 * change, named by orchestration as a session and a board, published on the
 * running request's bus.
 *
 * The seam fills what orchestration never names: the tenant, from the running
 * request's verified identity, and the request itself as the notice's origin.
 * The notice goes on the session's topic narrowed to the board, with kind
 * `board` and the changed task's id, through the same end-of-turn queue (`publishNotices`) as the store writes' notices
 * (`publish-writes.ts`), so a failed publish never fails the write it follows.
 *
 * A row added to the board also goes out on the board's own scope topic (its
 * ledger's session, user or org), which the engine works out from the ledger
 * handle it handed out, never from anything orchestration names. On the user
 * topic it names no task: that topic spans the user's orgs (as
 * `noticePathFor` keeps entry keys off it).
 */
import type { BoardNoticeSeam, TopicScope } from "@flow-state-dev/core/internal";
import { publishNotices } from "./publish-writes";
import type { ChangeBus } from "./types";

// FIX-2625.
/** A board's scope topic, before its tenant: the ledger's scope and its session, user or org id. */
export type BoardScopeTopic = { scope: TopicScope; id: string };

/** The seam for one request: its bus, its tenant and its id, and where a ledger handle's board lives. */
export function createBoardNoticeSeam(
  bus: ChangeBus,
  request: {
    requestId: string;
    tenantId: string | undefined;
    /** The scope topic of the ledger behind a handle this request's context handed out; `undefined` for any other object. */
    boardTopicOf: (ledger: object) => BoardScopeTopic | undefined;
  }
): BoardNoticeSeam {
  return {
    publish: (change) =>
      publishNotices(bus, [
        {
          topic: { scope: "session", id: change.sessionId, tenantId: request.tenantId ?? "", resource: change.board },
          kind: "board",
          origin: { requestId: request.requestId },
          ids: [change.taskId]
        }
      ]),
    publishInsert: (insert) => {
      const at = request.boardTopicOf(insert.ledger);
      if (at === undefined) return;
      publishNotices(bus, [
        {
          topic: { scope: at.scope, id: at.id, tenantId: request.tenantId ?? "", resource: insert.board },
          kind: "board",
          origin: { requestId: request.requestId },
          ...(at.scope === "user" ? {} : { ids: [insert.taskId] })
        }
      ]);
    }
  };
}
