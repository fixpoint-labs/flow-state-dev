/**
 * The engine's half of the board-notice seam (FIX-2429): a task board's
 * change, named by orchestration as a session and a board, published on the
 * running request's bus.
 *
 * The seam fills what orchestration never names: the tenant, from the running
 * request's verified identity, and the request itself as the notice's origin.
 * The notice goes on the session's topic narrowed to the board, with kind
 * `board`, through the same end-of-turn queue as the store writes' notices
 * (`publish-writes.ts`), so a failed publish never fails the write it follows.
 */
import type { BoardNoticeSeam } from "@flow-state-dev/core/types";
import { queueNotices } from "./publish-writes";
import type { ChangeBus } from "./types";

/** The seam for one request: its bus, its tenant and its id. */
export function createBoardNoticeSeam(bus: ChangeBus, request: { requestId: string; tenantId: string | undefined }): BoardNoticeSeam {
  return {
    publish: (change) =>
      queueNotices(bus, [
        {
          topic: { scope: "session", id: change.sessionId, tenantId: request.tenantId ?? "", resource: change.board },
          kind: "board",
          origin: { requestId: request.requestId }
        }
      ])
  };
}
