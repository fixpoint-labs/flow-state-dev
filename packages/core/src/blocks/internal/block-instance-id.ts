/**
 * Deterministic blockInstanceId construction and parsing.
 *
 * A blockInstanceId is a function of (requestId, path, attempt) so that
 * retries and resumed requests produce the same ID for the same logical
 * block step. The encoding is opaque to consumers — treat as a string —
 * but we expose a parser for internal tooling (durable execution,
 * checkpoint correlation, debugging).
 *
 * Format: `${requestId}:${path}:${attempt}`
 *   - `path` is a slash-delimited structural locator (e.g. `root/then[0]/iter[2]`).
 *   - `attempt` is a 0-indexed retry counter scoped to `(requestId, path)`.
 *
 * Neither component is URL-encoded; requestId and path are expected to
 * use a restricted character set (alphanumerics, `_`, `-`, `/`, `[`, `]`).
 */

export const ROOT_BLOCK_PATH = "root";

/**
 * Builds a deterministic blockInstanceId from the request, path, and attempt.
 *
 * Regenerating this ID with the same inputs always produces the same string.
 * That invariant is what lets durable execution correlate attempt N with
 * attempt N+1 for the same logical step.
 */
export function buildBlockInstanceId(
  requestId: string,
  path: string,
  attempt: number
): string {
  return `${requestId}:${path}:${attempt}`;
}

/**
 * Extends a parent path with a child segment.
 *
 * The parent is a slash-delimited path (e.g. `root/then[0]`); the segment
 * is appended as a new structural step (`then[1]`, `iter[3]`, `branch[cold]`).
 */
export function extendBlockPath(parentPath: string, segment: string): string {
  return `${parentPath}/${segment}`;
}

/**
 * Formats a structural segment for a sequencer operation. The operation
 * name is the op kind (`then`, `parallel`, `forEach`, `rescue`, etc.) and
 * the index disambiguates sibling positions within the same sequencer.
 */
export function blockPathSegment(op: string, index: number): string {
  return `${op}[${index}]`;
}

/**
 * Formats an iteration segment for iterative sequencer ops (forEach,
 * loopBack, doUntil, doWhile). Iterations are identity-bearing, so they
 * get their own segment after the op segment — e.g. `forEach[0]/iter[2]`.
 */
export function blockPathIteration(iteration: number): string {
  return `iter[${iteration}]`;
}

/**
 * Formats a router branch segment. Router branches are named in user code,
 * so we encode them by name rather than positional index.
 */
export function blockPathBranch(branchName: string): string {
  return `branch[${branchName}]`;
}

/**
 * Formats a rescue segment. Rescue handlers are attached at the sequencer
 * level; position within the rescue list disambiguates them.
 */
export function blockPathRescue(index: number): string {
  return `rescue[${index}]`;
}

/**
 * Formats a generator-tool segment. Each tool call gets its own path step
 * so durable execution can correlate individual tool invocations. `callId`
 * is typically the model-provided tool call ID, which is stable across
 * resumes — if that's not available, callers may pass a counter instead.
 */
export function blockPathTool(toolName: string, callId: string | number): string {
  return `tool[${toolName}][${callId}]`;
}

/**
 * Parses a deterministic blockInstanceId back into its components.
 *
 * Returns undefined for legacy or opaque IDs that don't match the expected
 * shape, so callers can opt into the structural components when present
 * without breaking on older formats.
 */
export function parseBlockInstanceId(
  id: string
): { requestId: string; path: string; attempt: number } | undefined {
  const firstColon = id.indexOf(":");
  const lastColon = id.lastIndexOf(":");
  if (firstColon === -1 || lastColon === firstColon) {
    return undefined;
  }

  const requestId = id.slice(0, firstColon);
  const path = id.slice(firstColon + 1, lastColon);
  const attemptRaw = id.slice(lastColon + 1);
  const attempt = Number(attemptRaw);
  if (!Number.isInteger(attempt) || attempt < 0) {
    return undefined;
  }

  return { requestId, path, attempt };
}
