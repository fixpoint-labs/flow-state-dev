/**
 * Deriving and adopting the child session a `key`-targeted dispatch runs in.
 *
 * The seam's safety rule: a caller supplies the *target* of an operation and
 * never the *authority* for it. A dispatcher hands over a key that names the
 * unit of work, and the seam builds the child session id from that key together
 * with the running request's server-derived identity — principal, tenant,
 * lineage, **and parent session**.
 *
 * The parent session is in the key material because every other verb on the
 * request host authorises by **descent**: settle resolves the board in the
 * session that dispatched this request, and liveness answers only for a session
 * whose parent chain reaches the current one. A child is therefore unreachable
 * except *through* the parent that owns it, which makes the parent part of what
 * the child **is**. A key that omits it names a child two owners can both claim,
 * and the loser's work settles onto the wrong board while its own liveness calls
 * refuse — unsettleable, invisible.
 *
 * **The key alone discriminates among a parent's children.** Two dispatchers in
 * one flow that compute the same key from the same parent land on the same
 * child, and that is the point: an issue's `implement` and `review` phases
 * keyed on the issue share one checkout session. A board that wants its
 * per-task children apart from another board's frames its own id into the key.
 */
import { createHash } from "node:crypto";

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
   * same id, same principal and same key would otherwise derive the same child,
   * and the new conversation would ADOPT the old lineage's child — silently
   * inheriting an address belonging to a conversation that no longer exists.
   * Conjoining the lineage makes the two children different sessions, so nothing
   * has to detect the case.
   */
  lineageId: string;
};

/** Prefix so a derived child id is recognisable in a store dump. */
const CHILD_ID_PREFIX = "dsx_";

/**
 * Length-prefix a field so field boundaries cannot be confused.
 *
 * Without this, `("u_ab", "c")` and `("u_a", "bc")` hash identically, and since
 * the parent session id is one of the fields that is a cross-lineage collision
 * reachable by choosing ids — exactly what the derivation exists to prevent.
 */
function framed(value: string | undefined): string {
  const v = value ?? "";
  return `${v.length}:${v}`;
}

/**
 * Derive the child session id for a `key`-targeted dispatch.
 *
 * Deterministic by design — the same identity and key must land on the same
 * child, because that is what makes "adopt if it already exists" the ordinary
 * retry path rather than a conflict.
 */
export function deriveChildSessionId(identity: DerivationIdentity, key: string): string {
  const material = [
    framed(identity.tenantId),
    framed(identity.userId),
    framed(identity.parentSessionId),
    framed(identity.lineageId),
    framed(key)
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
};

/** The subset of a stored session record adoption inspects. */
export type AdoptionCandidate = {
  flowKind: string;
  userId: string;
  tenantId?: string;
  orgId?: string;
  parentSessionId?: string;
};

/** Which field disagreed. Reported for diagnostics; the caller refuses by name. */
export type AdoptionMismatch =
  | "flowKind"
  | "userId"
  | "tenantId"
  | "orgId"
  | "parentSessionId";

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
 * the adopted record's parent chain does not reach the real parent, so liveness
 * refuses for work that is genuinely the caller's.
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
  return { adoptable: true };
}
