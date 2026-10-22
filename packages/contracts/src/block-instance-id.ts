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
 *   - `path` is a slash-delimited structural locator (e.g. `root/step[0]/iter[2]`).
 *   - `attempt` is a 0-indexed retry counter scoped to `(requestId, path)`.
 *
 * Structural segments the framework generates (`step[N]`, `iter[N]`, …) use a
 * restricted character set. Segments that embed *user-controlled* values —
 * tool names and call ids (`blockPathTool`) and router branch names
 * (`blockPathBranch`) — percent-escape the reserved characters `% / [ ] :`
 * before embedding, so an opaque call id or branch name cannot inject a path
 * delimiter. This keeps both exact-equality and prefix matching over the
 * logical path unambiguous (FIX-814): a sibling call id containing `]`, `[`,
 * `/`, or `:` can never collide with, or be misread as nested under, another
 * call's path.
 */

export const ROOT_BLOCK_PATH = "root";

/**
 * Percent-escapes the characters reserved by the blockInstanceId path grammar
 * (`%`, `/`, `[`, `]`, `:`) inside a user-controlled segment value. `%` is
 * encoded first so the escape sequences it introduces are not double-encoded.
 * Escaping is one-way — path values are compared, never decoded — so no
 * inverse is provided.
 */
function escapeSegmentValue(value: string): string {
  return value
    .replace(/%/g, "%25")
    .replace(/\//g, "%2F")
    .replace(/\[/g, "%5B")
    .replace(/\]/g, "%5D")
    .replace(/:/g, "%3A");
}

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
 * The parent is a slash-delimited path (e.g. `root/step[0]`); the segment
 * is appended as a new structural step (`step[1]`, `iter[3]`, `branch[cold]`).
 */
export function extendBlockPath(parentPath: string, segment: string): string {
  return `${parentPath}/${segment}`;
}

/**
 * Formats a structural segment for a sequencer operation. The operation
 * name is the op kind (`step`, `parallel`, `forEach`, `rescue`, etc.) and
 * the index disambiguates sibling positions within the same sequencer.
 */
export function blockPathSegment(op: string, index: number): string {
  return `${op}[${index}]`;
}

/**
 * Formats an iteration segment for iterative sequencer ops (forEach,
 * doUntil, doWhile). Iterations are identity-bearing, so they get their own
 * segment after the op segment — e.g. `forEach[0]/iter[2]`. (`loopBack`
 * re-executions use the `loop[N]` prefix segment instead; see `blockPathLoop`.)
 */
export function blockPathIteration(iteration: number): string {
  return `iter[${iteration}]`;
}

/**
 * Formats a loop-generation segment for `loopBack` re-executions. Unlike
 * `iter[N]` (which `doUntil`/`doWhile`/`forEach` append after the op segment
 * for a single looped block), this is a parent-scope prefix: a `loopBack` jump
 * re-runs a *range* of steps, so the marker wraps the whole pass. Inserting it
 * before the op segment gives every block re-executed in generation N a shared
 * `loop[N]` ancestor, so their `blockInstanceId`s are distinct per iteration.
 * Generation 0 (the first pass) emits no segment, so non-looping code and first
 * iterations are byte-for-byte unchanged.
 */
export function blockPathLoop(generation: number): string {
  return `loop[${generation}]`;
}

/**
 * Formats a router branch segment. Router branches are named in user code,
 * so we encode them by name rather than positional index. The name is
 * percent-escaped (it is user-controlled) so a branch name containing a path
 * delimiter cannot corrupt the structural locator.
 */
export function blockPathBranch(branchName: string): string {
  return `branch[${escapeSegmentValue(branchName)}]`;
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
 *
 * Both `toolName` and `callId` are user/provider-controlled and therefore
 * percent-escaped before embedding: an opaque call id containing `]`, `[`,
 * `/`, or `:` cannot inject a delimiter that would let a sibling call's path
 * be misread as a prefix of another's (FIX-814). Callers that fold a
 * model-step index into the disambiguator (e.g. `` `${stepNumber}:${callId}` ``)
 * rely on the embedded `:` being escaped here.
 */
export function blockPathTool(toolName: string, callId: string | number): string {
  return `tool[${escapeSegmentValue(toolName)}][${escapeSegmentValue(String(callId))}]`;
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
