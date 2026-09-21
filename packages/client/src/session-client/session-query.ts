/**
 * The one place the cardinality branch is written (FIX-1477 D1, S1).
 *
 * Every surface that lists a flow's sessions has to answer the same question —
 * is this address an instance, or a kind? — and until this helper existed the
 * answer was written three times: in the DevTool's session hook, in
 * `@flow-state-dev/react`'s `useFlow`, and in the navigator being promoted out
 * of the DevTool. Three copies of a two-branch rule is how one of them ends up
 * sending the wrong key, which does not fail: the server answers, with the
 * wrong rows or with none.
 *
 * It lives in `client` rather than in `react` because it is not React — it is
 * one line of query construction — and `client` is the package both hosts
 * already reach.
 */
import type { FlowListEntry } from "../types";
import type { ListSessionsOptions } from "./sessions";

/**
 * The listing filter for one flow address.
 *
 * A collection member's sessions are filed under its exact id: its rows record
 * the definition's kind, not the address, so a kind filter would sweep in every
 * sibling copy's sessions. A singleton lists by kind — its id *is* its kind,
 * and the kind filter additionally finds sessions saved before owners were
 * recorded, which the exact-owner filter never matches (BR-12).
 *
 * Exactly one of the two keys is returned, never both. The server intersects
 * them, so a helper that sent a `flowKind` alongside a `flowId` would silently
 * narrow the listing to rows that agree on both — which for a collection member
 * is none of them.
 *
 * An address the flow list does not carry reads as a singleton. That is not a
 * fallback for an error case: `useFlow` builds its first listing before its own
 * `listFlows` has resolved, and a kind filter is what every flow was before
 * collection cardinality existed.
 */
export function sessionQueryFor(
  address: string,
  /**
   * The flow list, or as much of it as the caller holds. Only `id` and
   * `cardinality` are read, and the parameter says so: a caller that has one
   * entry rather than the whole listing should not have to fabricate the
   * fields this function never looks at.
   */
  flows: readonly Pick<FlowListEntry, "id" | "cardinality">[]
): Pick<ListSessionsOptions, "flowId"> | Pick<ListSessionsOptions, "flowKind"> {
  const entry = flows.find((flow) => flow.id === address);

  return entry?.cardinality === "collection"
    ? { flowId: address }
    : { flowKind: address };
}
