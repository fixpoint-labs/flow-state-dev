/**
 * Canonical type union and entry parser for `/api/flows/[...path]`. Matching
 * is driven by `routes/router.ts`; this file owns the public type and the
 * segments-to-path adapter that the catch-all dispatcher calls.
 */
import { matchFlowRoute } from "./router";

export type ParsedFlowRoute =
  | { kind: "list_flows" }
  | { kind: "capabilities" }
  | { kind: "execute_action"; flowKind: string; actionName: string; sessionId?: string }
  | { kind: "request_stream"; flowKind: string; requestId: string }
  | { kind: "list_sessions" }
  | { kind: "get_session"; sessionId: string }
  | { kind: "list_session_requests"; sessionId: string }
  | { kind: "get_session_state"; sessionId: string }
  | { kind: "create_session"; flowKind: string }
  | { kind: "delete_session"; sessionId: string }
  | { kind: "patch_session_metadata"; sessionId: string }
  | { kind: "user_stream"; userId: string }
  | { kind: "transcribe" }
  | { kind: "retry_request"; flowKind: string; sessionId: string; requestId: string }
  | { kind: "active_requests" }
  | { kind: "check_interrupted_requests"; userId: string }
  | { kind: "get_resource_content"; sessionId: string; ref: string }
  | { kind: "get_collection_item_content"; sessionId: string; ref: string; topic: string }
  | { kind: "create_collection_item"; sessionId: string; ref: string }
  | { kind: "update_resource_content"; sessionId: string; ref: string; topic: string }
  | { kind: "delete_collection_item"; sessionId: string; ref: string; topic: string }
  | { kind: "list_collection_state"; sessionId: string; ref: string }
  | { kind: "get_collection_item_state"; sessionId: string; ref: string; topic: string }
  | { kind: "get_resource_manifest"; sessionId: string }
  | { kind: "abort_request"; flowKind: string; requestId: string }
  | { kind: "resume_suspension"; flowKind: string; requestId: string }
  | { kind: "request_status"; flowKind: string; requestId: string }
  | { kind: "debug_list_resources"; sessionId: string }
  | { kind: "debug_list_collection_items"; sessionId: string; ref: string }
  | { kind: "debug_get_resource_content"; sessionId: string; ref: string }
  | {
      kind: "debug_get_collection_item_content";
      sessionId: string;
      ref: string;
      topic: string;
    }
  | { kind: "not_found" };

/**
 * Parses a catch-all method/path tuple into a typed flow route shape.
 * Empty / whitespace-only segments are dropped so request paths that come
 * in as `["", "sessions", "abc"]` from a Next.js catch-all match the same
 * way as `["sessions", "abc"]`.
 */
export function parseFlowRoute(
  method: string,
  path: string[] | undefined
): ParsedFlowRoute {
  const segments = (Array.isArray(path) ? path : [])
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const pathname = segments.length === 0 ? "/" : `/${segments.join("/")}`;
  return matchFlowRoute(method, pathname);
}
