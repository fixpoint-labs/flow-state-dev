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
  | { kind: "list_session_children"; sessionId: string }
  | { kind: "get_session_state"; sessionId: string }
  | { kind: "session_stream"; sessionId: string }
  | { kind: "create_session"; flowKind: string }
  | { kind: "delete_session"; sessionId: string }
  | { kind: "patch_session_metadata"; sessionId: string }
  | { kind: "user_stream"; userId: string }
  | { kind: "transcribe" }
  | { kind: "retry_request"; flowKind: string; sessionId: string; requestId: string }
  | { kind: "continue_request"; flowKind: string; sessionId: string; requestId: string }
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
  | { kind: "debug_list_suspensions"; sessionId: string }
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
 *
 * `path` holds **decoded** segments, the shape a framework catch-all (Next's
 * `params.path`) hands over: each URL segment percent-decoded exactly once.
 * The segments are re-encoded before matching and the matcher decodes once,
 * so each segment reaches the route as given: a literal `%5F` or `/` inside
 * one stays in it. A host that only has the raw URL decodes it with
 * {@link decodePathSegments} first.
 */
export function parseFlowRoute(
  method: string,
  path: string[] | undefined
): ParsedFlowRoute {
  const segments = (Array.isArray(path) ? path : [])
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const pathname =
    segments.length === 0 ? "/" : `/${segments.map(encodeURIComponent).join("/")}`;
  return matchFlowRoute(method, pathname);
}

/**
 * Splits a raw, still-encoded URL path (the part beneath the mount prefix)
 * into the decoded segments {@link parseFlowRoute} takes: split on `/` first,
 * then decode each segment once, so an encoded `%2F` stays inside its
 * segment. A segment that is not valid percent-encoding is kept as written.
 */
export function decodePathSegments(rawPath: string): string[] {
  return rawPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}
