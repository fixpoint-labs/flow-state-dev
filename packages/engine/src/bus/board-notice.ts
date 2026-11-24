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
 * `noticePathFor` keeps entry keys off it). A session ledger shared to its
 * lineage is the running session's on its scope topic, which another lineage
 * member's view never hears, so its row also goes out on the session owner's
 * user topic, narrowed to the board and naming no task: where a
 * lineage-shared resource's write publishes (`publishSessionResourceChange`).
 *
 * A row added to a partitioned ledger names its partition on each of those
 * notices, raw: the bus is the server's own. The push edge sends it
 * to a browser only as an opaque key (`push/partition-key.ts`), which a view's
 * answer lists for each partition it read, so a board of another partition
 * (another conversation's) skips the notice.
 */
import type { BoardNoticeSeam, TopicScope } from "@flow-state-dev/core/internal";
import { publishNotices } from "./publish-writes";
import type { ChangeBus } from "./types";

// FIX-2625.
/** A board's scope topic, before its tenant: the ledger's scope and its session, user or org id. */
export type BoardScopeTopic = {
  scope: TopicScope;
  id: string;
  // FIX-2733.
  /**
   * For a session ledger shared to its lineage, on a host with a view: the
   * session record's owner, whose user topic every lineage member's view hears.
   */
  lineageOwnerUserId?: string;
};

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
      const tenantId = request.tenantId ?? "";
      const origin = { requestId: request.requestId };
      // FIX-2750: the partition rides on the bus raw; the push edge keys it.
      const partition = insert.partition !== undefined ? { partition: insert.partition } : {};
      publishNotices(bus, [
        {
          topic: { scope: at.scope, id: at.id, tenantId, resource: insert.board },
          kind: "board",
          origin,
          ...(at.scope === "user" ? {} : { ids: [insert.taskId] }),
          ...partition
        },
        ...(at.lineageOwnerUserId === undefined
          ? []
          : [{ topic: { scope: "user" as const, id: at.lineageOwnerUserId, tenantId, resource: insert.board }, kind: "board" as const, origin, ...partition }])
      ]);
    }
  };
}
