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
import { readFileSync } from "node:fs";
import path from "node:path";
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

/**
 * WHERE the notice mounts — a structural guard, not a render test.
 *
 * The defect this pins is a RENDER GATE: the notice was mounted inside
 * `ReportSummary`, so it painted only on the Summary tab. The Theses/Summary
 * choice is sticky once a memo is picked and is not reset when another stored
 * report is opened, so a reader could open a pre-fix report, read memos derived
 * from fabricated zeros, and never meet the sole disclosure. The component was
 * correct and the data reached it; the condition that hid it belonged to a
 * different participant. That is the FIX-1060 lesson, and this is its second
 * occurrence here — which is what earns a guard.
 *
 * It is structural (which module mounts the banner) rather than a render
 * assertion because this package has no React render harness, and adding one
 * would be a larger change than the fix. It is deliberately coarse: it asserts
 * only WHICH module owns the mount, so it survives formatting and refactors and
 * fails on the one move that matters — putting the disclosure back behind a tab.
 *
 * A SOURCE-GREP PIN, NOT A BEHAVIOURAL TEST. It matches on source text, so a
 * rename or a re-import can fail it without anything regressing. If it breaks,
 * first ask whether the mount actually moved behind a gate; if it did not,
 * re-point the pin. The durable fix is a pure `reasonsForProvenance` helper
 * these could assert against directly — a refactor, tracked with the rest of the
 * data-honesty follow-ups, not a reason to trust a red run here blindly.
 */
describe("the provenance notice is not gated behind a tab", () => {
  const read = (p: string) =>
    readFileSync(path.resolve(__dirname, "..", p), "utf8");

  it("mounts in the pane, above the Theses/Summary switch", () => {
    const pane = read("components/theses/theses-pane.tsx");
    expect(pane).toContain("<ReportProvenanceBanner");
    // The mount must precede the tab conditional, or it is inside a branch.
    expect(pane.indexOf("<ReportProvenanceBanner")).toBeLessThan(
      pane.indexOf('tab === "summary"'),
    );
  });

  it("is NOT mounted inside the Summary branch", () => {
    // `ReportSummary` renders only when the Summary tab is active, so a mount
    // here is by construction invisible to a reader sitting on Theses.
    const summary = read("components/summary/report-summary.tsx");
    expect(summary).not.toContain("<ReportProvenanceNotice");
    expect(summary).not.toContain("<ReportProvenanceBanner");
  });
});

/**
 * The banner needs a stored report to disclose anything about.
 *
 * `app/page.tsx` binds `useSession(flow.activeSessionId)`, which on a fresh
 * install is `undefined`. `useClientData` then reads off a null snapshot and
 * every exposed field comes back `undefined` — which the pre-fix predicate,
 * correctly, treats as pre-fix. So a first-time user with no reports at all was
 * told their report "was generated before a correction".
 *
 * The fix has one shape and one anti-shape, and both are asserted here because
 * the anti-shape is the tempting one: gate on a report EXISTING, never on
 * defaulting the absent stamp to present. Defaulting the stamp would silence
 * the legacy case the notice exists for — a real stored report with no stamp
 * must keep reading pre-fix. Under-claim on the empty state, not on the legacy
 * one.
 *
 * Structural for the same reason as the block above: this package has no React
 * render harness, and adding one is a larger change than the fix. It is a
 * SOURCE-GREP PIN too — a rename can fail it without a regression, so read a
 * failure as "check whether the gate moved", not as proof that it did.
 */
describe("the provenance notice does not fire on an empty state", () => {
  const source = readFileSync(
    path.resolve(__dirname, "..", "components/summary/report-provenance-notice.tsx"),
    "utf8",
  );

  it("gates the reasons on a stored report existing", () => {
    expect(source).toContain("session.snapshot !== null");
    // The gate has to reach the reasons — a computed-but-unread flag is the
    // FIX-1060 drop point one more time.
    expect(source).toMatch(/hasStoredReport && isPreDataHonestyFix\(/);
  });

  it("does NOT default the absent stamp to present", () => {
    // The anti-shape. Any of these would make a legacy report read as current,
    // which is the unfixable direction: nothing distinguishes those runs later.
    expect(source).not.toMatch(/dataHonestyContractVersion\s*\?\?/);
    expect(source).not.toMatch(
      /isPreDataHonestyFix\([^)]*\?\?\s*DATA_HONESTY_CONTRACT_VERSION/,
    );
  });
});
