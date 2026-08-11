/**
 * The provenance notice's shared copy asserts no cause (FIX-1063 / FIX-780).
 *
 * The rule, stated once so a third consumer does not have to re-learn it: THE
 * MOMENT A COMPONENT TAKES A LIST OF REASONS, ITS SHARED COPY CANNOT DESCRIBE
 * ANY ONE REASON'S CAUSE. Copy that names a cause can serve exactly one entry,
 * which makes the list decorative.
 *
 * It is not a style rule — it is the same honesty rule the rest of this issue
 * enforces, one layer up. The notice's first version read "figures below may
 * include values that were never measured", which is true of a report predating
 * the data-honesty contract and FALSE of one predating the flat-stance
 * labeling fix, whose two price levels WERE measured — only which of them was
 * the stop was lost. Filing that reason under that body would raise a false
 * alarm about good numbers, which is the mirror image of presenting absent data
 * as measured.
 *
 * These assertions fail exactly when someone moves a cause back into the shared
 * copy, or writes a reason that leans on the body to finish its sentence.
 */
import { describe, expect, it } from "vitest";
import {
  PROVENANCE_NOTICE_BODY,
  PROVENANCE_NOTICE_HEADING,
  PRE_DATA_HONESTY_FIX_REASON,
} from "../components/summary/report-provenance-notice";

/**
 * Words that can only appear in copy describing a SPECIFIC correction. Each
 * belongs to one of the two known reasons — none can be true of both, which is
 * exactly why none may appear in copy shown for either.
 */
const CAUSE_SPECIFIC_TERMS = [
  // data-honesty (FIX-1063)
  "zero",
  "measured",
  "unavailable",
  "figure",
  "honesty",
  // trade-levels labeling (FIX-780)
  "price",
  "level",
  "stop",
  "target",
  "flat",
  "stance",
];

describe("the notice's shared copy names no cause", () => {
  const shared = `${PROVENANCE_NOTICE_HEADING} ${PROVENANCE_NOTICE_BODY}`.toLowerCase();

  for (const term of CAUSE_SPECIFIC_TERMS) {
    it(`does not mention "${term}"`, () => {
      expect(shared).not.toContain(term);
    });
  }

  it("still tells the reader what the notice is and what to do", () => {
    // Neutral is not empty. The shared copy must carry the two things true of
    // EVERY reason: that the report predates a correction, and that re-running
    // produces a current one.
    expect(shared).toContain("predates");
    expect(shared).toContain("re-run");
  });
});

describe("each reason is self-contained", () => {
  // Add a new reason constant here when a third consumer lands. A reason that
  // cannot stand alone is one the shared body would have to finish — which is
  // the failure this file exists to prevent.
  const REASONS = { PRE_DATA_HONESTY_FIX_REASON };

  for (const [name, reason] of Object.entries(REASONS)) {
    it(`${name} names its own correction and what it means for the numbers`, () => {
      const text = reason.toLowerCase();
      // It says what the desk did wrong…
      expect(text).toContain("zero");
      expect(text).toContain("unavailable");
      // …and what a reader should therefore distrust. Without this half the
      // reader gets a mechanism with no consequence, and the old body is what
      // supplied the consequence.
      expect(text).toContain("never have been measured");
      // A reason is a sentence, not a label.
      expect(reason.length).toBeGreaterThan(40);
    });
  }
});
