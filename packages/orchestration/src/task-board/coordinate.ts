/**
 * The routing coordinate that addresses a detached worker (FIX-982 P2).
 *
 * A task author names a `topic` and an `assignee`. Everything else about where
 * that work runs is derived by the framework — this module owns the derivation's
 * addressing half: turning "which worker on which board" into a stable string
 * that survives a restart and cannot be confused with a different worker.
 *
 * **No execution and no session ids here.** Deriving the child session a
 * detached request runs in belongs to the runtime's injection seam, which hashes
 * the routing seed together with the running request's tenant, principal and
 * parent session — facts a board cannot see and must not supply. What this
 * module produces is the seed's discriminating half; the seam does the rest.
 *
 * ## Why the coordinate is a tagged union and not a string
 *
 * A board routes three ways: to a named assignee, to a single uniform worker, or
 * to a floor worker that catches whatever no assignee claimed. Assignee names are
 * unrestricted, so a board may legally declare one called `uniform` or `floor`.
 * Collapsing the three into a bare string therefore merges unrelated workers —
 * silently, and only on the boards unlucky enough to pick those names. The tag
 * is serialized *before* the name, so the two can never alias.
 */
import type { DetachedRoutingSeed } from "@flow-state-dev/core/types";

/**
 * Which worker on a board a task routes to.
 *
 * Always derived from the board's own declarations, never read off a task, a
 * payload, or request metadata — a task supplies the assignee *name*, and the
 * board decides which of the three cases that resolves to (BP-031).
 */
export type WorkerCoordinate =
  | { readonly kind: "assignee"; readonly name: string }
  | { readonly kind: "uniform" }
  | { readonly kind: "floor" };

/**
 * Length-prefix a field so its boundary cannot migrate into the next one.
 *
 * Without framing, board `"a"` + assignee `"b:c"` and board `"a:b"` + assignee
 * `"c"` encode identically, and two unrelated workers become one address. The
 * same idiom the runtime's own key derivation uses, for the same reason.
 */
function framed(value: string): string {
  return `${value.length}:${value}`;
}

/**
 * Encode a coordinate as the stable string a binding is keyed by.
 *
 * Stable across restarts and across processes: it is built from the board's
 * declarations alone, with no clock, no counter, and no host identity in it.
 */
export function coordinateKey(coordinate: WorkerCoordinate): string {
  switch (coordinate.kind) {
    case "assignee":
      return `assignee|${framed(coordinate.name)}`;
    case "uniform":
      return "uniform";
    case "floor":
      return "floor";
  }
}

/** Human-readable form of a coordinate, for refusal messages and diagnostics. */
export function coordinateLabel(coordinate: WorkerCoordinate): string {
  return coordinate.kind === "assignee" ? `assignee:${coordinate.name}` : coordinate.kind;
}

/**
 * Build the routing seed a detached start is addressed by.
 *
 * **`boardId` belongs in `key`, and leaving it out is a real collision.** The
 * runtime derives a child session from `(tenant, principal, parent session,
 * topic, key)` — there is no board dimension in that material. Two boards in one
 * flow, both with an assignee named `implement`, both handed a task on topic
 * `FIX-1` would otherwise derive the *same* child session and interleave two
 * unrelated bodies of work in one history. Framing `boardId` into `key` is what
 * keeps the two apart, and it is why this helper exists rather than call sites
 * passing `coordinateKey()` straight through.
 *
 * A blank or whitespace-only topic is normalized to absent and the caller's
 * fallback is used instead, so topic continuity is opted into and never
 * accidental — two tasks that both forgot a topic must not silently share a
 * Workstream.
 *
 * @param boardId The declaring board's explicit, stable id.
 * @param coordinate Which worker on that board.
 * @param topic The task's topic; blank falls back to `topicFallback`.
 * @param topicFallback Used when `topic` is absent or blank — normally the task id.
 */
export function workstreamRoutingSeed(options: {
  boardId: string;
  coordinate: WorkerCoordinate;
  topic?: string;
  topicFallback: string;
}): DetachedRoutingSeed {
  const trimmed = options.topic?.trim();
  const topic = trimmed === undefined || trimmed.length === 0 ? options.topicFallback : trimmed;
  return {
    topic,
    key: `${framed(options.boardId)}|${framed(coordinateKey(options.coordinate))}`
  };
}
