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
  | { kind: "resume_request"; flowKind: string; sessionId: string; requestId: string }
  | { kind: "active_requests" }
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

  // POST /api/flows/:flowKind/sessions/:sessionId/requests/:requestId/resume
  if (
    normalizedMethod === "POST" &&
    segments.length === 6 &&
    segments[1] === "sessions" &&
    segments[3] === "requests" &&
    segments[5] === "resume"
  ) {
    return {
      kind: "resume_request",
      flowKind: segments[0],
      sessionId: segments[2],
      requestId: segments[4]
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

  return { kind: "not_found" };
}
