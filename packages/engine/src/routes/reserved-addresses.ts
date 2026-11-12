// FIX-2624.
/**
 * The one HTTP guard for the server's write addresses: a write session id and
 * the default write flow. Every route the router parses passes through it
 * before authorization, so a route added later is covered by having a
 * `sessionId` or `flowKind` at all, not by remembering a check.
 *
 * A write session is answered as an unknown session, the default write flow as
 * an unknown flow: the same answers an id nobody holds gets. The only routes
 * that may name the default write flow are its writer's own request routes
 * (stream, status, abort), which a client uses to hear its write settle; each
 * is checked against the declaring flow's sign-in (`ownerFlowOf`). A send
 * addressed to a resource names neither; its handler derives both.
 *
 * Bodies that carry a session id (session create, action) are checked in their
 * handlers with {@link isWriteSessionId}; dispatches from any transport are
 * checked again at the host (`createInboundTransportHost`).
 */
import { unknownFlowMessage } from "../context/instance-pin";
import { DEFAULT_WRITE_FLOW, isWriteSessionId } from "../resources/default-write-flow";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import { jsonResponse, unknownSessionResponse } from "./route-utils";

/** The routes that may name the default write flow: a writer hearing its own write. */
const WRITER_REQUEST_ROUTES: ReadonlySet<ParsedFlowRoute["kind"]> = new Set([
  "request_stream",
  "request_status",
  "abort_request"
]);

/** The answer to a route that names a write address, or `undefined` to let it run. */
export function reservedAddressRefusal(route: ParsedFlowRoute): Response | undefined {
  const fields = route as { sessionId?: unknown; flowKind?: unknown };
  if (typeof fields.sessionId === "string" && isWriteSessionId(fields.sessionId)) {
    return unknownSessionResponse(fields.sessionId);
  }
  if (fields.flowKind === DEFAULT_WRITE_FLOW && !WRITER_REQUEST_ROUTES.has(route.kind)) {
    return jsonResponse(404, { error: unknownFlowMessage(DEFAULT_WRITE_FLOW) });
  }
  return undefined;
}
