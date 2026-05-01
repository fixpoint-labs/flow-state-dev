/**
 * Canonical catch-all route parser for `/api/flows/[...path]`.
 */
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
  | { kind: "abort_request"; flowKind: string; requestId: string }
  | { kind: "request_status"; flowKind: string; requestId: string }
  | { kind: "not_found" };

function cleanSegments(path: string[] | undefined): string[] {
  if (!Array.isArray(path)) {
    return [];
  }

  return path
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/**
 * Parses a catch-all method/path tuple into a typed flow route shape.
 */
export function parseFlowRoute(
  method: string,
  path: string[] | undefined
): ParsedFlowRoute {
  const normalizedMethod = method.toUpperCase();
  const segments = cleanSegments(path);

  if (normalizedMethod === "GET" && segments.length === 0) {
    return { kind: "list_flows" };
  }

  if (
    normalizedMethod === "GET" &&
    segments.length === 1 &&
    segments[0] === "capabilities"
  ) {
    return { kind: "capabilities" };
  }

  if (
    normalizedMethod === "GET" &&
    segments.length === 1 &&
    segments[0] === "sessions"
  ) {
    return { kind: "list_sessions" };
  }

  if (
    normalizedMethod === "GET" &&
    segments.length === 2 &&
    segments[0] === "sessions"
  ) {
    return {
      kind: "get_session",
      sessionId: segments[1]
    };
  }

  if (
    normalizedMethod === "DELETE" &&
    segments.length === 2 &&
    segments[0] === "sessions"
  ) {
    return {
      kind: "delete_session",
      sessionId: segments[1]
    };
  }

  // PATCH /api/flows/sessions/:sessionId/metadata
  if (
    normalizedMethod === "PATCH" &&
    segments.length === 3 &&
    segments[0] === "sessions" &&
    segments[2] === "metadata"
  ) {
    return {
      kind: "patch_session_metadata",
      sessionId: segments[1]
    };
  }

  if (
    normalizedMethod === "GET" &&
    segments.length === 3 &&
    segments[0] === "sessions" &&
    segments[2] === "requests"
  ) {
    return {
      kind: "list_session_requests",
      sessionId: segments[1]
    };
  }

  if (
    normalizedMethod === "GET" &&
    segments.length === 3 &&
    segments[0] === "sessions" &&
    segments[2] === "state"
  ) {
    return {
      kind: "get_session_state",
      sessionId: segments[1]
    };
  }

  if (
    normalizedMethod === "GET" &&
    segments.length === 3 &&
    segments[0] === "users" &&
    segments[2] === "stream"
  ) {
    return {
      kind: "user_stream",
      userId: segments[1]
    };
  }

  if (
    normalizedMethod === "POST" &&
    segments.length === 3 &&
    segments[1] === "actions"
  ) {
    return {
      kind: "execute_action",
      flowKind: segments[0],
      actionName: segments[2]
    };
  }

  if (
    normalizedMethod === "POST" &&
    segments.length === 4 &&
    segments[2] === "actions"
  ) {
    return {
      kind: "execute_action",
      flowKind: segments[0],
      sessionId: segments[1],
      actionName: segments[3]
    };
  }

  if (
    normalizedMethod === "GET" &&
    segments.length === 4 &&
    segments[1] === "requests" &&
    segments[3] === "stream"
  ) {
    return {
      kind: "request_stream",
      flowKind: segments[0],
      requestId: segments[2]
    };
  }

  if (
    normalizedMethod === "POST" &&
    segments.length === 2 &&
    segments[1] === "sessions"
  ) {
    return {
      kind: "create_session",
      flowKind: segments[0]
    };
  }

  if (
    normalizedMethod === "POST" &&
    segments.length === 1 &&
    segments[0] === "transcribe"
  ) {
    return { kind: "transcribe" };
  }

  // POST /api/flows/:flowKind/sessions/:sessionId/requests/:requestId/retry
  if (
    normalizedMethod === "POST" &&
    segments.length === 6 &&
    segments[1] === "sessions" &&
    segments[3] === "requests" &&
    segments[5] === "retry"
  ) {
    return {
      kind: "retry_request",
      flowKind: segments[0],
      sessionId: segments[2],
      requestId: segments[4]
    };
  }

  // POST /api/flows/:flowKind/requests/:requestId/abort
  if (
    normalizedMethod === "POST" &&
    segments.length === 4 &&
    segments[1] === "requests" &&
    segments[3] === "abort"
  ) {
    return {
      kind: "abort_request",
      flowKind: segments[0],
      requestId: segments[2]
    };
  }

  // GET /api/flows/:flowKind/requests/:requestId/status
  if (
    normalizedMethod === "GET" &&
    segments.length === 4 &&
    segments[1] === "requests" &&
    segments[3] === "status"
  ) {
    return {
      kind: "request_status",
      flowKind: segments[0],
      requestId: segments[2]
    };
  }

  // GET /api/flows/active-requests
  if (
    normalizedMethod === "GET" &&
    segments.length === 1 &&
    segments[0] === "active-requests"
  ) {
    return { kind: "active_requests" };
  }

  // POST /api/flows/users/:userId/check-interrupted
  if (
    normalizedMethod === "POST" &&
    segments.length === 3 &&
    segments[0] === "users" &&
    segments[2] === "check-interrupted"
  ) {
    return {
      kind: "check_interrupted_requests",
      userId: segments[1]
    };
  }

  // GET /api/flows/sessions/:sessionId/resources/:ref/content
  if (
    normalizedMethod === "GET" &&
    segments.length === 5 &&
    segments[0] === "sessions" &&
    segments[2] === "resources" &&
    segments[4] === "content"
  ) {
    return {
      kind: "get_resource_content",
      sessionId: segments[1],
      ref: segments[3]
    };
  }

  // GET /api/flows/sessions/:sessionId/resources/:ref/:topic/content
  if (
    normalizedMethod === "GET" &&
    segments.length === 6 &&
    segments[0] === "sessions" &&
    segments[2] === "resources" &&
    segments[5] === "content"
  ) {
    return {
      kind: "get_collection_item_content",
      sessionId: segments[1],
      ref: segments[3],
      topic: segments[4]
    };
  }

  // POST /api/flows/sessions/:sessionId/resources/:ref (create collection item)
  if (
    normalizedMethod === "POST" &&
    segments.length === 4 &&
    segments[0] === "sessions" &&
    segments[2] === "resources"
  ) {
    return {
      kind: "create_collection_item",
      sessionId: segments[1],
      ref: segments[3]
    };
  }

  // PATCH /api/flows/sessions/:sessionId/resources/:ref/:topic/content
  if (
    normalizedMethod === "PATCH" &&
    segments.length === 6 &&
    segments[0] === "sessions" &&
    segments[2] === "resources" &&
    segments[5] === "content"
  ) {
    return {
      kind: "update_resource_content",
      sessionId: segments[1],
      ref: segments[3],
      topic: segments[4]
    };
  }

  // DELETE /api/flows/sessions/:sessionId/resources/:ref/:topic
  if (
    normalizedMethod === "DELETE" &&
    segments.length === 5 &&
    segments[0] === "sessions" &&
    segments[2] === "resources"
  ) {
    return {
      kind: "delete_collection_item",
      sessionId: segments[1],
      ref: segments[3],
      topic: segments[4]
    };
  }

  return { kind: "not_found" };
}
