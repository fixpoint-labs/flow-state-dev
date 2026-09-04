/**
 * The provenance a dispatched request carries, and the **one** reader that is
 * allowed to trust it.
 *
 * The dispatch seam stamps `metadata.dispatch` onto every request it starts,
 * exactly as a webhook rides `metadata.webhook`. And exactly like that, **the
 * bag is not authority**: `metadata` is the caller's own free-form bag, spread
 * verbatim into the dispatch envelope by the HTTP action route, so a public
 * action invoked over HTTP with `{ metadata: { dispatch: { … } } }` presents as
 * a dispatched request to anything that reads the bag directly.
 *
 * What makes it trustworthy is the trusted **`source`**, which the seam stamps
 * and no caller can set: the HTTP action route hard-codes `source: "http"`, and
 * nothing anywhere derives `source` from a request body. So every consumer goes
 * through {@link readDispatchStamp}, which checks the source first and hands
 * back `undefined` otherwise. One reader rather than a check per consumer: a
 * rule applied at three call sites is a rule the fourth call site skips.
 */
import { INTERNAL_SOURCE, TASK_SOURCE } from "./transport-sources";

/**
 * The server-assembled provenance the seam stamps. Everything here is derived
 * by the seam from values it closed over — the address, the sending block and
 * session, the key a child was derived from, and for a delivery into an
 * existing session the recipient's lineage at acceptance.
 */
export type DispatchStamp = {
  readonly type: "internal" | "task";
  readonly target: string;
  readonly from: { readonly block: string; readonly sessionId: string };
  readonly key?: string;
  /**
   * The recipient incarnation the seam approved, present only for an `id`
   * delivery. Acceptance and execution are not the same moment — a delivery
   * can be accepted, wait behind a held concurrency key, and run later — and a
   * recipient deleted and recreated under the same id in that window gets a new
   * lineage that nothing downstream re-checks. `runAction`'s incarnation guard
   * compares against this.
   */
  readonly recipientLineageId?: string;
};

/**
 * Read the dispatch stamp off a request, **only** when the runtime stamped a
 * dispatch source. Returns `undefined` for every other source, including a
 * caller who wrote a perfectly shaped `metadata.dispatch` into an HTTP body.
 *
 * Shape-checked rather than cast: the bag has survived a store round-trip and
 * may have been written by an older release, so a missing field is a real
 * state (BP-030), and every consumer treats "no stamp" as "not a dispatched
 * request", which is the safe reading.
 */
export function readDispatchStamp(
  source: string | undefined,
  metadata: unknown
): DispatchStamp | undefined {
  if (source !== INTERNAL_SOURCE && source !== TASK_SOURCE) return undefined;
  const dispatch = (metadata as { dispatch?: unknown } | undefined)?.dispatch;
  if (dispatch === null || typeof dispatch !== "object") return undefined;
  const candidate = dispatch as Partial<DispatchStamp>;
  if (
    (candidate.type !== "internal" && candidate.type !== "task") ||
    typeof candidate.target !== "string" ||
    candidate.from === null ||
    typeof candidate.from !== "object" ||
    typeof candidate.from.block !== "string" ||
    typeof candidate.from.sessionId !== "string"
  ) {
    return undefined;
  }
  if (candidate.recipientLineageId !== undefined && typeof candidate.recipientLineageId !== "string") {
    return undefined;
  }
  return candidate as DispatchStamp;
}
