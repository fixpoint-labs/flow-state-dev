/**
 * The data-honesty contract stamp and the marking it drives (FIX-1063).
 *
 * Reports generated before the fix cannot be repaired — nothing in a stored
 * record separates a zero the desk measured from one it invented — so the
 * guarantee is forward-looking and old reports are MARKED instead. That makes
 * the marking machinery itself a real-money surface, and these tests pin the
 * property that matters most about it:
 *
 *   ABSENT ALWAYS MEANS PRE-FIX.
 *
 * Every direction of "we don't know" — a session persisted before the field
 * existed, a client projection that dropped it, a stopped run, an unparsed
 * value — must land on pre-fix, never on post-fix. Under-claiming shows a
 * notice on a report that didn't need one, which is recoverable. Over-claiming
 * certifies a fabricated report as honest, which is not: nothing distinguishes
 * those runs afterwards.
 */
import { describe, expect, it } from "vitest";
import {
  DATA_HONESTY_CONTRACT_VERSION,
  isPreDataHonestyFix,
} from "../flows/analysis/data-honesty-contract";
import { sessionStateSchema } from "../flows/analysis/state";
import analysisFlow from "../flows/analysis/flow";

describe("isPreDataHonestyFix — absent means pre-fix, in every direction", () => {
  it("reads a stamped run as post-fix", () => {
    expect(isPreDataHonestyFix(DATA_HONESTY_CONTRACT_VERSION)).toBe(false);
  });

  it("reads every shape of 'not stamped' as pre-fix", () => {
    // null: a session that ran but was never stamped (a run from the window
    // before the stamp write landed).
    expect(isPreDataHonestyFix(null)).toBe(true);
    // undefined: a session persisted before the field existed, or a client
    // projection that dropped it — the silent failure the allow-list test
    // below guards against.
    expect(isPreDataHonestyFix(undefined)).toBe(true);
    // A different contract version is not THIS contract.
    expect(isPreDataHonestyFix(DATA_HONESTY_CONTRACT_VERSION + 1)).toBe(true);
    expect(isPreDataHonestyFix(0)).toBe(true);
    // Shapes that could only arrive from a corrupted or hand-edited record.
    // None of them may be mistaken for a stamp.
    expect(isPreDataHonestyFix("1")).toBe(true);
    expect(isPreDataHonestyFix(true)).toBe(true);
    expect(isPreDataHonestyFix({})).toBe(true);
  });
});

describe("session state tolerates the old shape (BP-030)", () => {
  it("a session persisted before the field existed parses and reads as pre-fix", () => {
    // The legacy record: no `dataHonestyContractVersion` key at all. It must
    // parse — a throw here would make every pre-fix report unopenable — and it
    // must default to the pre-fix reading.
    const parsed = sessionStateSchema.parse({
      ticker: "NVDA",
      date: "2026-05-06",
    });

    expect(parsed.dataHonestyContractVersion).toBeNull();
    expect(isPreDataHonestyFix(parsed.dataHonestyContractVersion)).toBe(true);
  });

  it("a record written by a LATER contract version still parses", () => {
    // Forward tolerance: the field is typed as an int, not a literal, so a
    // record from a future contract is readable (and, being a different
    // contract, reads as not-this-one) rather than throwing on load.
    const parsed = sessionStateSchema.parse({
      dataHonestyContractVersion: DATA_HONESTY_CONTRACT_VERSION + 1,
    });

    expect(parsed.dataHonestyContractVersion).toBe(DATA_HONESTY_CONTRACT_VERSION + 1);
    expect(isPreDataHonestyFix(parsed.dataHonestyContractVersion)).toBe(true);
  });

  it("a stamped session round-trips through the schema", () => {
    const parsed = sessionStateSchema.parse({
      dataHonestyContractVersion: DATA_HONESTY_CONTRACT_VERSION,
    });

    expect(isPreDataHonestyFix(parsed.dataHonestyContractVersion)).toBe(false);
  });
});

describe("the stamp survives the client projection", () => {
  it("is on the session client allow-list", () => {
    // The silent-drop point. `client.expose` is an explicit allow-list: without
    // the field named there the stamp never reaches the browser, `useClientData`
    // yields undefined, and EVERY report renders as pre-fix — a failure that
    // looks exactly like the feature working, because the pre-fix notice is
    // what you'd see either way.
    //
    // Asserted against the flow definition rather than a rendered component so
    // it fails at the seam that actually breaks, in a test that needs no DOM.
    const exposed = (
      analysisFlow as unknown as {
        session?: { client?: { expose?: string[] } };
      }
    ).session?.client?.expose;

    expect(exposed).toBeDefined();
    expect(exposed).toContain("dataHonestyContractVersion");
    // The neighbours the Summary reads in the same `useClientData` call, so a
    // future edit that rewrites this list can't drop the stamp alone.
    expect(exposed).toContain("stoppedReason");
    expect(exposed).toContain("runComplete");
  });
});
