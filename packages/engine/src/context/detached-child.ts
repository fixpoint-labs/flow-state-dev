/**
 * Deriving and adopting the child session a dispatch targets (FIX-999).
 *
 * The seam's safety rule: a caller supplies the *target* of an operation and
 * never the *authority* for it. It hands over a routing seed and the seam builds
 * the child session id from that seed together with the running request's
 * server-derived identity — principal, tenant, **and parent session**.
 *
 * The parent session is in the key material because every other verb on this
 * seam authorises by **descent**: settle resolves the board in the session that
 * dispatched this request, and interrupt and liveness answer only for a session
 * whose parent chain reaches the current one. A child is therefore unreachable
 * except *through* the parent that owns it, which makes the parent part of what
 * the child **is**. A key that omits it names a child two owners can both claim,
 * and the loser's work settles onto the wrong board while its own interrupt and
 * liveness calls refuse — unsettleable, uninterruptible, invisible.
 */
import { createHash } from "node:crypto";
import { framed } from "@flow-state-dev/core/types";

/** The server-derived facts a child key is built from. Never caller-supplied. */
export type DerivationIdentity = {
  /** The running request's principal. */
  userId: string;
  /** The tenant the running request belongs to, if multi-tenant. */
  tenantId: string | undefined;
  /** The session that is spawning the child — the child's parent. */
  parentSessionId: string;
  /**
   * The lineage the parent belongs to (FIX-1068).
   *
   * In the key material because a session id can be deleted and recreated: the
   * same id, same principal and same seed would otherwise derive the same child,
   * and the new conversation would ADOPT the old lineage's child — silently
   * inheriting an address belonging to a conversation that no longer exists.
   * Conjoining the lineage makes the two children different sessions, so nothing
   * has to detect the case.
   */
  lineageId: string;
};

/** Prefix so a derived child id is recognisable in a store dump. */
const CHILD_ID_PREFIX = "dsx_";

// Fields are length-framed with core's codec so field boundaries cannot be
// confused: without it `("u_ab", "c") and `("u_a", "bc")` hash identically,
// and since the parent session id is one of the fields that is a cross-lineage
// collision reachable by choosing ids — exactly what the derivation exists to
// prevent. An absent tenant frames as the empty field.

/**
 * The namespace a dispatched child's key is framed under, so no other
 * derivation from the same parent can land on a dispatched child by choosing
 * the same string.
 */
const DISPATCH_NAMESPACE = "dispatch";

/**
 * Derive the child session id for a `{ key }`-targeted dispatch.
 *
 * The identity material — tenant, principal, parent session and lineage,
 * none of them caller-supplied — with the key
 * framed under its own namespace. Deterministic by design: the same key from
 * the same parent lands on the same child, which is what makes "adopt if it
 * already exists" the ordinary retry path rather than a conflict. The key alone
 * discriminates among a parent's dispatched children, so two dispatchers in one
 * flow that compute the same key share one child — a board that wants its
 * per-task children apart from another board's frames its own id into the key.
 *
 * `targetFlowKind` is the **other** flow a cross-flow dispatch addresses, and is
 * part of the material precisely because the key alone discriminates: without
 * it, one parent dispatching key `"job"` to two different flows derives one
 * child id for both, and the second dispatch meets a record whose `flowKind`
 * does not match and is refused `key-occupied` — a collision between two
 * addresses that have nothing to do with each other. Appended rather than
 * folded into the existing fields, so a same-flow derivation (which omits it)
 * still produces the id it produced before this shipped: an in-flight retry
 * across the upgrade re-enters the child it started, rather than minting a
 * second one beside it.
 */
export function deriveDispatchChildSessionId(
  identity: DerivationIdentity,
  key: string,
  targetFlowKind?: string
): string {
  const material = [
    framed(identity.tenantId ?? ""),
    framed(identity.userId),
    framed(identity.parentSessionId),
    framed(identity.lineageId),
    framed(DISPATCH_NAMESPACE),
    framed(key),
    ...(targetFlowKind !== undefined ? [framed(targetFlowKind)] : [])
  ].join("|");

  const digest = createHash("sha256").update(material, "utf8").digest("hex");
  return `${CHILD_ID_PREFIX}${digest.slice(0, 32)}`;
}

/** The identity a genuine child of this request must carry. */
export type ExpectedChildIdentity = {
  flowKind: string;
  userId: string;
  tenantId: string | undefined;
  orgId: string | undefined;
  parentSessionId: string;
  /**
   * The parent's lineage. A `{ key }` dispatch always requires the child to
   * share it, since `sharedToLineage` resources in the child resolve against
   * that root. Optional only so a caller that compares nothing else can omit
   * it; absent → not compared.
   */
  lineageId?: string;
};

/** The subset of a stored session record adoption inspects. */
export type AdoptionCandidate = {
  flowKind: string;
  userId: string;
  tenantId?: string;
  orgId?: string;
  parentSessionId?: string;
  lineageId?: string;
};

/** Which field disagreed. Reported for diagnostics; the caller refuses by name. */
export type AdoptionMismatch =
  | "flowKind"
  | "userId"
  | "tenantId"
  | "orgId"
  | "parentSessionId"
  | "lineageId";

export type AdoptionVerdict =
  | { adoptable: true }
  | { adoptable: false; mismatch: AdoptionMismatch };

/** `null` and `undefined` both mean "absent" on a persisted record (BP-030). */
function sameOptional(a: string | undefined | null, b: string | undefined | null): boolean {
  const left = a == null ? undefined : a;
  const right = b == null ? undefined : b;
  return left === right;
}

/**
 * Decide whether a record found at the derived child key may be adopted.
 *
 * **Why this validates more than the key implies.** The derivation already binds
 * principal, tenant and parent session, so a record the *seam* created at this
 * key necessarily matches. But the seam is not the only writer: the public
 * session-create route lets a caller choose both the session id and its
 * metadata, so a same-principal caller can pre-create a record sitting at the
 * deterministic child id. `createExecutionContext` validates user, tenant and org
 * bindings — but **not `flowKind` and not `parentSessionId`** — so a pre-created
 * top-level record, or one belonging to another flow, would sail through that
 * check and be adopted.
 *
 * Both outcomes are bad in the same way: the flow runs against a session bound to
 * the wrong flow kind, and because every other verb here authorises by descent,
 * the adopted record's parent chain does not reach the real parent, so interrupt
 * and liveness refuse for work that is genuinely the caller's.
 *
 * A mismatch is a **named refusal**, never a silent fall-through to create — the
 * record belongs to someone, and overwriting it is not this verb's call.
 */
export function evaluateAdoption(
  record: AdoptionCandidate,
  expected: ExpectedChildIdentity
): AdoptionVerdict {
  if (record.flowKind !== expected.flowKind) {
    return { adoptable: false, mismatch: "flowKind" };
  }
  if (record.userId !== expected.userId) {
    return { adoptable: false, mismatch: "userId" };
  }
  if (!sameOptional(record.tenantId, expected.tenantId)) {
    return { adoptable: false, mismatch: "tenantId" };
  }
  if (!sameOptional(record.orgId, expected.orgId)) {
    return { adoptable: false, mismatch: "orgId" };
  }
  if (!sameOptional(record.parentSessionId, expected.parentSessionId)) {
    return { adoptable: false, mismatch: "parentSessionId" };
  }
  // The lineage is in the derivation, so a record the seam minted carries the
  // parent's lineage by construction. A pre-created record does not: it was
  // minted with whatever lineage the session route gave it, and adopting it
  // would put every lineage-shared resource in the child on a different root
  // than the parent's — the ledger a hand-off must settle against.
  if (expected.lineageId !== undefined && !sameOptional(record.lineageId, expected.lineageId)) {
    return { adoptable: false, mismatch: "lineageId" };
  }
  return { adoptable: true };
}
