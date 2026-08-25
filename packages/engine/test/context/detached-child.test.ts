/**
 * Child-session derivation and adoption for the detached-start verb (FIX-999).
 *
 * The seam's central safety rule is that a caller supplies the *target* of an
 * operation and never the *authority* for it. It hands over a routing seed; the
 * seam derives the child session key from that seed plus the running request's
 * server-derived identity. Two collisions must therefore be **inexpressible**
 * rather than rejected:
 *
 *   - two principals with the same seed (a model authors the same topic twice);
 *   - **one principal's two parent sessions** with the same seed.
 *
 * The second is the one that is easy to miss. Deriving over `[principal, seed]`
 * alone lets session B derive session A's child key, adopt A's child — whose
 * `parentSessionId` still points at A — and then every downstream verb follows
 * the wrong lineage: settle writes to A's board, and interrupt and liveness both
 * refuse for B because their descendant checks walk a parent chain that never
 * reaches it. B's work becomes unsettleable, uninterruptible and invisible.
 *
 * Adoption has a second door onto the same failure. The public session-create
 * route lets a same-principal caller choose the session id, so a record can be
 * *pre-created* at the deterministic child key. `createExecutionContext`
 * validates user, tenant and org bindings but not `flowKind` and not
 * `parentSessionId`, so a pre-created top-level record — or one belonging to a
 * different flow — would pass that check and be adopted. Adoption therefore
 * validates the record's full identity itself.
 */
import { describe, it, expect } from "vitest";
import {
  deriveChildSessionId,
  evaluateAdoption,
  type DerivationIdentity
} from "../../src/context/detached-child";

const base: DerivationIdentity = {
  userId: "u_alice",
  tenantId: "t_acme",
  parentSessionId: "s_parent_a"
};

describe("child session derivation", () => {
  it("is deterministic for the same identity and seed — that is what makes adoption possible", () => {
    const a = deriveChildSessionId(base, { topic: "review" });
    const b = deriveChildSessionId(base, { topic: "review" });
    expect(a).toBe(b);
  });

  it("gives two principals different children for an identical seed", () => {
    const alice = deriveChildSessionId(base, { topic: "review" });
    const bob = deriveChildSessionId({ ...base, userId: "u_bob" }, { topic: "review" });
    expect(alice).not.toBe(bob);
  });

  it("gives ONE principal's two parent sessions different children for an identical seed", () => {
    // The round-3 defect. Without the parent session in the key material these
    // are equal, session B adopts session A's child, and B's work settles onto
    // A's board while B's own interrupt and liveness calls refuse.
    const fromA = deriveChildSessionId(base, { topic: "review" });
    const fromB = deriveChildSessionId(
      { ...base, parentSessionId: "s_parent_b" },
      { topic: "review" }
    );
    expect(fromA).not.toBe(fromB);
  });

  it("separates tenants", () => {
    const acme = deriveChildSessionId(base, { topic: "review" });
    const other = deriveChildSessionId({ ...base, tenantId: "t_other" }, { topic: "review" });
    expect(acme).not.toBe(other);
  });

  it("distinguishes seeds, including the optional discriminator", () => {
    const t1 = deriveChildSessionId(base, { topic: "review" });
    const t2 = deriveChildSessionId(base, { topic: "triage" });
    const t3 = deriveChildSessionId(base, { topic: "review", key: "second" });
    expect(new Set([t1, t2, t3]).size).toBe(3);
  });

  it("does not confuse field boundaries — concatenation-style collisions are not reachable", () => {
    // A naive `${a}${b}` derivation collides here. Encoding lengths (or a
    // delimiter that cannot appear in the values) is what prevents it.
    const x = deriveChildSessionId(
      { userId: "u_a", tenantId: undefined, parentSessionId: "bc" },
      { topic: "t" }
    );
    const y = deriveChildSessionId(
      { userId: "u_ab", tenantId: undefined, parentSessionId: "c" },
      { topic: "t" }
    );
    expect(x).not.toBe(y);
  });
});

describe("adoption identity validation", () => {
  const seed = { topic: "review" };
  const childId = deriveChildSessionId(base, seed);

  /** What the seam expects a genuine child of this request to look like. */
  const expected = {
    flowKind: "board",
    userId: base.userId,
    tenantId: base.tenantId,
    orgId: undefined,
    parentSessionId: base.parentSessionId
  };

  const genuineChild = { ...expected, id: childId };

  it("adopts a record whose full identity matches", () => {
    expect(evaluateAdoption(genuineChild, expected)).toEqual({ adoptable: true });
  });

  it("refuses a record belonging to a different flow kind", () => {
    // createExecutionContext never checks this, so without the check here the
    // current flow would run against a session bound to another flow.
    const result = evaluateAdoption({ ...genuineChild, flowKind: "other-flow" }, expected);
    expect(result).toEqual({ adoptable: false, mismatch: "flowKind" });
  });

  it("refuses a PRE-CREATED top-level record at the derived key", () => {
    // The public session-create route lets a same-principal caller choose the
    // session id. A top-level record has no parent, so every descent-authorised
    // verb on this seam would refuse for work that is genuinely the caller's.
    const result = evaluateAdoption({ ...genuineChild, parentSessionId: undefined }, expected);
    expect(result).toEqual({ adoptable: false, mismatch: "parentSessionId" });
  });

  it("refuses a record parented to a different session", () => {
    const result = evaluateAdoption(
      { ...genuineChild, parentSessionId: "s_somewhere_else" },
      expected
    );
    expect(result).toEqual({ adoptable: false, mismatch: "parentSessionId" });
  });

  it("refuses a record belonging to another principal", () => {
    const result = evaluateAdoption({ ...genuineChild, userId: "u_bob" }, expected);
    expect(result).toEqual({ adoptable: false, mismatch: "userId" });
  });

  it("refuses a record in another tenant", () => {
    const result = evaluateAdoption({ ...genuineChild, tenantId: "t_other" }, expected);
    expect(result).toEqual({ adoptable: false, mismatch: "tenantId" });
  });

  it("refuses a record bound to a different org", () => {
    const result = evaluateAdoption({ ...genuineChild, orgId: "o_other" }, expected);
    expect(result).toEqual({ adoptable: false, mismatch: "orgId" });
  });

  it("treats null and undefined as the same absent value (BP-030)", () => {
    // A store that nulls absent keys hands back `null` for `parentSessionId`;
    // records written before the field existed read back `undefined`. Both mean
    // the same thing, and a strict `!==` would refuse a genuine child.
    const nulled = { ...genuineChild, orgId: null as unknown as undefined };
    expect(evaluateAdoption(nulled, { ...expected, orgId: undefined })).toEqual({
      adoptable: true
    });
  });
});
