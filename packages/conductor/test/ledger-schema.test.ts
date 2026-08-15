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
import { RETIRED_SIGNAL_KINDS, signalSchema, type Signal } from "../src/model/signals";
import { worldSchema, type World } from "../src/model/world";
import {
  ENTITY_ID,
  HEAD,
  freshApproval,
  pr,
  proved,
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

  // A row records an action's *kind* and nothing else about it, so the only
  // thing that reproduces an escalation's reason is re-running `decide` from the
  // row's own signal. That is why the failure reason lives on the signal rather
  // than being read out of the dispatch record: `decide` is pure over the signal
  // and the world, and a reason it fetched from a collection would be a
  // transition the ledger cannot replay.
  it("replays a dispatch failure to the reason it escalated with, not to a generic one", () => {
    const detail = "git fetch origin main failed in /repo (exit 128).";
    const stored = roundTrip(
      row({
        signalKind: "dispatch_failed",
        signal: signal("dispatch_failed", { detail }),
        world: worldWith("spec", pr()),
        actionKind: "escalate",
        phaseBefore: "SPEC",
        phaseAfter: "SPEC",
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

    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toMatchObject({ kind: "escalate", reason: `Dispatch d1 failed: ${detail}` });
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
      proved("failed"),
    );

    expect(roundTrip(row({ world })).world).toEqual(world);
  });

  it("preserves every signal kind's payload, so no variant is silently narrowed", () => {
    for (const kind of SIGNAL_KINDS) {
      const original = signal(kind);
      expect(signalSchema.parse(JSON.parse(JSON.stringify(original)))).toEqual(original);
    }
  });

  it("reads a `ci_concluded` row from either side of the pullNumber change", () => {
    // The field is new, and rows written before it exists have to keep parsing
    // — a ledger that rejects its own history cannot replay it (BP-030). The
    // sweep above already covers the legacy shape, since the fixture carries no
    // `pullNumber`; this pins that the field survives the round trip when it is
    // there, rather than being dropped back to the unscoped shape on the way in.
    const scoped = signal("ci_concluded", { pullNumber: 7 });
    expect(signalSchema.parse(JSON.parse(JSON.stringify(scoped)))).toEqual(scoped);

    const legacy = signal("ci_concluded");
    expect(signalSchema.parse(JSON.parse(JSON.stringify(legacy)))).not.toHaveProperty(
      "pullNumber",
    );
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

describe("a row naming a signal kind conductor has retired (BP-030)", () => {
  /** A row the tick wrote while the kind was still in the vocabulary. */
  function retiredRow(kind: string, payload: Record<string, unknown>) {
    return {
      id: "led-0",
      entityId: ENTITY_ID,
      entityKind: "issue",
      seq: 1,
      signalKind: kind,
      signalSynthesized: false,
      signal: { kind, entityId: ENTITY_ID, at: "2026-08-14T12:00:00Z", ...payload },
      world: worldWith("implementation", pr()),
      actionKind: "escalate",
      phaseBefore: "IMPLEMENTATION",
      phaseAfter: "IMPLEMENTATION",
      gate: null,
      at: "2026-08-14T12:00:00Z",
    };
  }

  it.each(RETIRED_SIGNAL_KINDS)(
    "reads a `%s` row back rather than throwing a discriminator error at the tick",
    (kind) => {
      // Deleting a signal kind deletes it from `signalSchema`'s discriminated
      // union, and a row that names one would otherwise fail to parse with
      // "Invalid discriminator value" — wedging every read of an entity whose
      // ledger happens to contain one, forever, over a transition that already
      // happened. It degrades instead, the way `decide` degrades on unknown
      // input.
      const stored = ledgerEntryStateSchema.parse(retiredRow(kind, { path: "AGENTS.md" }));

      // The row still says what arrived and what conductor did about it.
      expect(stored.signalKind).toBe(kind);
      expect(stored.actionKind).toBe("escalate");
      expect(stored.world).not.toBeNull();

      // The payload is dropped rather than half-parsed: there is no branch left
      // to reduce it, so a replay must not be handed something that looks live.
      expect(stored.signal).toBeNull();
    },
  );

  it("still rejects a malformed payload of a kind conductor does handle", () => {
    // The tolerance is a named list, not a blanket `.catch(null)`. A real
    // defect in a live signal is still loud.
    expect(() =>
      ledgerEntryStateSchema.parse({
        ...row(),
        signal: { kind: "approved", entityId: ENTITY_ID, at: "2026-08-14T12:00:00Z" },
      }),
    ).toThrow();
  });

  it("names only kinds that are genuinely gone from the vocabulary", () => {
    // A kind listed here *and* still in `SIGNAL_KINDS` would silently null out
    // a signal conductor can actually reduce.
    const live = RETIRED_SIGNAL_KINDS.filter((kind) =>
      (SIGNAL_KINDS as readonly string[]).includes(kind),
    );
    expect(live).toEqual([]);
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
