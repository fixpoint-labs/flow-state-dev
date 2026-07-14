/**
 * Unit tests for the thesis editor's pure form ↔ payload mapping (FIX-760).
 *
 * The test env is node + `.spec.ts` (no JSX), so — matching the
 * `buildHoldingRowModel` / `aggregate.ts` precedent — the load-bearing mapping
 * lives in pure helpers tested directly. These are INTENT-ENCODING tests: each
 * locks a real-money trust rule the dialog relies on.
 *
 *   - a blank optional field maps to `null`, NEVER a fabricated value;
 *   - the household × ticker key is canonicalized upper-case so it matches the
 *     holdings rows (a lower-case ticker would orphan the thesis);
 *   - a note-less tripwire row (the user's empty scaffold) is dropped on save —
 *     a tripwire with no observable is meaningless;
 *   - round-tripping a record → form → payload preserves the user's data;
 *   - Save is gated on a non-empty entry rationale (a thesis with no "why").
 */
import { describe, expect, it } from "vitest";
import {
  buildSaveThesisPayload,
  canSaveThesis,
  emptyThesisForm,
  thesisFormError,
  thesisRecordToForm,
} from "../components/portfolio/thesis-form";
import type { ThesisRecord } from "../src/domain/portfolio/schema/thesis-schema";

function record(overrides: Partial<ThesisRecord> = {}): ThesisRecord {
  return {
    ticker: "NVDA",
    entryRationale: "Durable AI compute moat.",
    invalidationConditions: "Gross margin compresses below 60%.",
    tripwires: [
      { kind: "price", note: "Breaks the stop", level: 90, byDate: null },
      { kind: "date", note: "Q3 print", level: null, byDate: "2026-11-01" },
    ],
    timeHorizon: "years",
    targetPrice: 200,
    stopPrice: 90,
    sourceSessionId: "sess_1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildSaveThesisPayload", () => {
  it("canonicalizes the ticker upper-case so it matches the holdings key", () => {
    const form = { ...emptyThesisForm(), entryRationale: "Why." };
    const payload = buildSaveThesisPayload("nvda", form);
    expect(payload.ticker).toBe("NVDA");
  });

  it("maps blank optional fields to null, never a fabricated value", () => {
    const payload = buildSaveThesisPayload("AAPL", {
      ...emptyThesisForm(),
      entryRationale: "Why.",
    });
    expect(payload.invalidationConditions).toBeNull();
    expect(payload.timeHorizon).toBeNull();
    expect(payload.targetPrice).toBeNull();
    expect(payload.stopPrice).toBeNull();
    expect(payload.tripwires).toEqual([]);
    expect(payload.sourceSessionId).toBeNull();
  });

  it("parses numeric fields and drops currency formatting", () => {
    const payload = buildSaveThesisPayload("AAPL", {
      ...emptyThesisForm(),
      entryRationale: "Why.",
      targetPrice: "$1,200",
      stopPrice: "90",
    });
    expect(payload.targetPrice).toBe(1200);
    expect(payload.stopPrice).toBe(90);
  });

  it("maps an unparseable number to null (server re-validates)", () => {
    const payload = buildSaveThesisPayload("AAPL", {
      ...emptyThesisForm(),
      entryRationale: "Why.",
      targetPrice: "abc",
    });
    expect(payload.targetPrice).toBeNull();
  });

  it("defaults sourceSessionId to null for a hand-written thesis", () => {
    const payload = buildSaveThesisPayload("AAPL", {
      ...emptyThesisForm(),
      entryRationale: "Why.",
    });
    expect(payload.sourceSessionId).toBeNull();
  });

  it("carries the existing report link through an edit (never erases it)", () => {
    // Editing a thesis adopted from a report must preserve its sourceSessionId —
    // passing null would erase the originating-report link FIX-760 preserves.
    const form = { ...emptyThesisForm(), entryRationale: "Revised conviction." };
    const payload = buildSaveThesisPayload("NVDA", form, "sess_42");
    expect(payload.sourceSessionId).toBe("sess_42");
  });

  it("drops a note-less tripwire scaffold but keeps a real one", () => {
    const payload = buildSaveThesisPayload("AAPL", {
      ...emptyThesisForm(),
      entryRationale: "Why.",
      tripwires: [
        { kind: "price", note: "  ", level: "50", byDate: "" },
        { kind: "event", note: "Guidance cut", level: "", byDate: "2026-09-01" },
      ],
    });
    expect(payload.tripwires).toEqual([
      { kind: "event", note: "Guidance cut", level: null, byDate: "2026-09-01" },
    ]);
  });
});

describe("thesisRecordToForm round-trip", () => {
  it("pre-fills the form from a record and rebuilds an equivalent payload", () => {
    const r = record();
    const form = thesisRecordToForm(r);
    expect(form.entryRationale).toBe(r.entryRationale);
    expect(form.invalidationConditions).toBe(r.invalidationConditions);
    expect(form.timeHorizon).toBe("years");
    expect(form.targetPrice).toBe("200");
    expect(form.stopPrice).toBe("90");
    expect(form.tripwires).toHaveLength(2);

    const payload = buildSaveThesisPayload(r.ticker, form);
    expect(payload.entryRationale).toBe(r.entryRationale);
    expect(payload.invalidationConditions).toBe(r.invalidationConditions);
    expect(payload.timeHorizon).toBe(r.timeHorizon);
    expect(payload.targetPrice).toBe(r.targetPrice);
    expect(payload.stopPrice).toBe(r.stopPrice);
    expect(payload.tripwires).toEqual(r.tripwires);
  });

  it("renders null record fields as blank strings, not 'null'", () => {
    const form = thesisRecordToForm(
      record({
        invalidationConditions: null,
        timeHorizon: null,
        targetPrice: null,
        stopPrice: null,
        tripwires: [],
      }),
    );
    expect(form.invalidationConditions).toBe("");
    expect(form.timeHorizon).toBe("");
    expect(form.targetPrice).toBe("");
    expect(form.stopPrice).toBe("");
  });
});

describe("canSaveThesis", () => {
  it("requires a non-empty entry rationale", () => {
    expect(canSaveThesis(emptyThesisForm())).toBe(false);
    expect(canSaveThesis({ ...emptyThesisForm(), entryRationale: "   " })).toBe(false);
    expect(canSaveThesis({ ...emptyThesisForm(), entryRationale: "Real why." })).toBe(true);
  });
});

describe("thesisFormError", () => {
  // The dialog validates against the same schema the action re-validates, so an
  // input the server would reject keeps the editor open instead of dispatching,
  // closing, and silently dropping the draft.
  it("returns null for a valid draft", () => {
    const form = { ...emptyThesisForm(), entryRationale: "Why.", targetPrice: "200" };
    expect(thesisFormError("NVDA", form)).toBeNull();
  });

  it("rejects a nonpositive target/stop price (would poison the prompt context)", () => {
    const neg = { ...emptyThesisForm(), entryRationale: "Why.", stopPrice: "-5" };
    const err = thesisFormError("NVDA", neg);
    expect(err).not.toBeNull();
    expect(err).toContain("stopPrice");
  });

  it("rejects more than 20 tripwires (the schema cap)", () => {
    const tripwires = Array.from({ length: 21 }, (_, i) => ({
      kind: "event" as const,
      note: `falsifier ${i}`,
      level: "",
      byDate: "",
    }));
    const err = thesisFormError("NVDA", {
      ...emptyThesisForm(),
      entryRationale: "Why.",
      tripwires,
    });
    expect(err).not.toBeNull();
    expect(err).toContain("tripwires");
  });

  it("rejects a non-blank unparseable price (a typo would silently clear it)", () => {
    // "20O" (letter O) parses to null → would erase an existing price under the
    // schema's nullable price. Must surface as an error, not a silent clear.
    const err = thesisFormError("NVDA", {
      ...emptyThesisForm(),
      entryRationale: "Why.",
      targetPrice: "20O",
    });
    expect(err).not.toBeNull();
    expect(err).toContain("targetPrice");
  });

  it("flags an unparseable level only on a KEPT tripwire (note present)", () => {
    // A note-less row is dropped on save, so its junk level is not an error; a
    // row WITH a note survives, so its junk level must be caught.
    const dropped = thesisFormError("NVDA", {
      ...emptyThesisForm(),
      entryRationale: "Why.",
      tripwires: [{ kind: "price", note: "  ", level: "9O", byDate: "" }],
    });
    expect(dropped).toBeNull();

    const kept = thesisFormError("NVDA", {
      ...emptyThesisForm(),
      entryRationale: "Why.",
      tripwires: [{ kind: "price", note: "Breaks stop", level: "9O", byDate: "" }],
    });
    expect(kept).not.toBeNull();
    expect(kept).toContain("tripwires.0.level");
  });
});
