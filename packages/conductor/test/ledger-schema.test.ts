/**
 * The ledger row, and the invariant it is supposed to carry.
 *
 * > **Every transition is reproducible from the ledger.**
 *
 * Nothing writes ledger rows yet — the tick is M1's remaining work — so these
 * tests exercise the schema directly rather than a writer. That is not a
 * stand-in for the goal check: it cannot show that conductor *does* record what
 * it reduced. What it can show, and does, is that a row which holds `decide`'s
 * three arguments survives the store round trip intact and re-runs to the same
 * answer — so the day a writer exists, the shape it writes into is already
 * known to be sufficient, and a field silently dropped from the schema fails
 * here rather than in an audit six months later.
 */

import { describe, expect, it } from "vitest";
import { decide } from "../src/driver/decide";
import { ledgerEntryStateSchema, type LedgerEntryState } from "../src/model/entities";
import type { EntityKind, Phase } from "../src/model/phases";
import { signalSchema, type Signal } from "../src/model/signals";
import { worldSchema, type World } from "../src/model/world";
import {
  ENTITY_ID,
  HEAD,
  freshApproval,
  pr,
  review,
  signal,
  SIGNAL_KINDS,
  worldWith,
} from "./fixtures";

/** A ledger row as the tick would append it, holding the whole reduction. */
function row(overrides: Partial<LedgerEntryState> = {}): LedgerEntryState {
  return ledgerEntryStateSchema.parse({
    id: "led-1",
    entityId: ENTITY_ID,
    entityKind: "issue" satisfies EntityKind,
    seq: 1,
    signalKind: "changes_requested",
    signalSynthesized: false,
    signal: signal("changes_requested"),
    world: worldWith("implementation", pr({ reviews: [review()] })),
    actionKind: "addressFeedback",
    phaseBefore: "IMPLEMENTATION",
    phaseAfter: "IMPLEMENTATION",
    gate: "awaiting_review",
    at: "2026-08-14T12:00:00Z",
    ...overrides,
  });
}

/** The store round trip: a row is written as JSON and read back through the schema. */
function roundTrip(value: LedgerEntryState): LedgerEntryState {
  return ledgerEntryStateSchema.parse(JSON.parse(JSON.stringify(value)));
}

describe("a ledger row carries `decide`'s three arguments", () => {
  it("re-runs the transition it recorded, from the row alone", () => {
    const stored = roundTrip(row());

    expect(stored.signal).not.toBeNull();
    expect(stored.world).not.toBeNull();

    const replayed = decide(
      {
        id: stored.entityId,
        kind: stored.entityKind as EntityKind,
        phase: stored.phaseBefore as Phase,
      },
      stored.signal as Signal,
      stored.world as World,
    );

    expect(replayed.map((action) => action.kind)).toContain(stored.actionKind);
  });

  it("replays a transition that moved the phase, not only one that stayed put", () => {
    // A fresh human approval on the spec PR completes SPEC and enters
    // IMPLEMENTATION — the row shape the phase chain is asserted over.
    const stored = roundTrip(
      row({
        signalKind: "approved",
        signal: signal("approved"),
        world: worldWith("spec", pr({ reviews: [freshApproval()] })),
        actionKind: "enterPhase",
        phaseBefore: "SPEC",
        phaseAfter: "IMPLEMENTATION",
        gate: null,
      }),
    );

    const replayed = decide(
      {
        id: stored.entityId,
        kind: stored.entityKind as EntityKind,
        phase: stored.phaseBefore as Phase,
      },
      stored.signal as Signal,
      stored.world as World,
    );

    const entered = replayed.find((action) => action.kind === "enterPhase");
    expect(entered).toBeDefined();
    expect(entered).toMatchObject({ phase: stored.phaseAfter });
  });

  it("preserves the world exactly, so a replay reduces against what the tick saw", () => {
    // The mutation guard: drop a field from `worldSchema` — or from any facts
    // schema under it — and the stored world stops equalling the one handed in.
    const world = worldWith(
      "implementation",
      pr({
        number: 42,
        checks: "failure",
        mergeable: false,
        baseRed: true,
        reviews: [review({ state: "CHANGES_REQUESTED" }), freshApproval("older-sha")],
      }),
      { reviewRounds: 3 },
      { goalCheck: "failed", guidanceHashes: { "docs/philosophy.md": "h1" } },
    );

    expect(roundTrip(row({ world })).world).toEqual(world);
  });

  it("preserves every signal kind's payload, so no variant is silently narrowed", () => {
    for (const kind of SIGNAL_KINDS) {
      const original = signal(kind);
      expect(signalSchema.parse(JSON.parse(JSON.stringify(original)))).toEqual(original);
    }
  });

  it("holds `pullRequests` to being keyed by PR number", () => {
    // JSON has no numeric object keys, so the key arrives as a string and has
    // to be coerced back — a lookup by number then finds it, and a key that is
    // not a PR number at all is rejected rather than stored as a PR.
    const world = worldWith("implementation", pr({ number: 7 }));
    const stored = worldSchema.parse(JSON.parse(JSON.stringify(world)));
    expect(stored.pullRequests[7]).toEqual(world.pullRequests[7]);

    expect(() =>
      worldSchema.parse({ ...world, pullRequests: { banana: pr({ number: 7 }) } }),
    ).toThrow();
  });
});

describe("a row written before the payload fields existed (BP-030)", () => {
  const legacy = {
    id: "led-0",
    entityId: ENTITY_ID,
    seq: 1,
    signalKind: "ci_concluded",
    signalSynthesized: false,
    actionKind: "addressFeedback",
    phaseBefore: "IMPLEMENTATION",
    phaseAfter: "IMPLEMENTATION",
    gate: "awaiting_ci",
    at: "2026-08-14T12:00:00Z",
  };

  it("still reads, rather than failing the tick that finds it", () => {
    expect(() => ledgerEntryStateSchema.parse(legacy)).not.toThrow();
  });

  it("reads back as auditable but not replayable, and says so in the data", () => {
    const stored = ledgerEntryStateSchema.parse(legacy);
    // Auditable: the phase chain and the recorded action are all still there.
    expect(stored.phaseBefore).toBe("IMPLEMENTATION");
    expect(stored.actionKind).toBe("addressFeedback");
    expect(stored.signalKind).toBe("ci_concluded");
    // Not replayable, and null rather than an empty world that would replay to
    // a different — and wrong — answer.
    expect(stored.entityKind).toBeNull();
    expect(stored.signal).toBeNull();
    expect(stored.world).toBeNull();
  });
});

describe("the summary fields alongside the payload", () => {
  it("agrees with the signal it summarizes, so a board and a replay cannot diverge", () => {
    const stored = roundTrip(
      row({ signalKind: "approved", signal: { ...signal("approved"), synthesized: true } }),
    );
    expect(stored.signalKind).toBe(stored.signal?.kind);
    expect(stored.signal?.synthesized).toBe(true);
  });

  it("rejects a row whose signal payload does not match its kind", () => {
    expect(() =>
      ledgerEntryStateSchema.parse({
        ...row(),
        // `ci_concluded` requires `conclusion` and `sha`; this carries neither.
        signal: { kind: "ci_concluded", entityId: ENTITY_ID, at: "2026-08-14T12:00:00Z" },
      }),
    ).toThrow();
  });

  it("rejects a world missing a fact `decide` reads", () => {
    const withoutPolicy: Record<string, unknown> = {
      ...worldWith("implementation", pr({ headSha: HEAD })),
    };
    delete withoutPolicy.policy;
    expect(() => ledgerEntryStateSchema.parse({ ...row(), world: withoutPolicy })).toThrow();
  });
});
