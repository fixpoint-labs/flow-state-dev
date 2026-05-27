/**
 * CRITICAL invariant: the pipeline (P1–P5) runs BLIND to the user's thesis.
 *
 * The whole audit value of Phase 6 rests on the upstream analysis never
 * having seen the user's belief — otherwise the agents drift toward
 * confirming it and the audit is theater. This spec walks every `tradingDesk`
 * capability preset EXCEPT `userThesis` and asserts that, even with a
 * sentinel thesis sitting in session state, none of their context resolvers
 * emit it. It then asserts the positive control: the `userThesis` preset DOES
 * surface the sentinel — that's the one place the thesis is allowed to flow.
 *
 * The preset resolvers are the contract, so we call them directly (the same
 * approach `investigate-capability.spec.ts` takes) rather than routing a full
 * flow.
 */
import { describe, expect, it } from "vitest";
import { tradingDesk } from "../src/flows/trading-desk/capability";

const THESIS_SENTINEL = "SENTINEL_THESIS_MUST_NOT_LEAK_42";
const RATIONALE_SENTINEL = "SENTINEL_RATIONALE_MUST_NOT_LEAK_99";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCap = any;
const presetDefs = (tradingDesk as AnyCap).__presetDefs as Record<string, any>;

/** Permissive ctx whose session state carries the sentinels plus a benign
 *  baseline. Resources are stubbed so memo/contribution resolvers return
 *  their "no data" sentinels rather than throwing. */
function ctxWithThesis() {
  return {
    session: {
      state: {
        ticker: "NVDA",
        date: "2026-05-06",
        costPreset: "full" as const,
        dataSource: "fixture" as const,
        activePhase: "phase-1" as const,
        userThesis: THESIS_SENTINEL,
        userThesisRationale: RATIONALE_SENTINEL,
      },
    },
    resources: {
      // formatAnalystMemos / memoState call getOptional; undefined is fine.
      memos: { getOptional: () => undefined },
      // readContributionsEntries uses optional chaining on .state.
      p2Contributions: { state: { entries: [] } },
      // formatUserInstructions reads .state; undefined → "".
      specialInstructions: { state: undefined },
    },
  };
}

/** Resolve every context entry on a preset into an array of strings. The
 *  `context` slot is either an object of resolver functions or an array whose
 *  elements are objects-of-resolvers or literal strings. */
async function renderPresetContext(presetDef: any): Promise<string[]> {
  const out: string[] = [];
  const context = presetDef?.context;
  if (context === undefined) return out;
  const entries = Array.isArray(context) ? context : [context];
  for (const entry of entries) {
    if (typeof entry === "string") {
      out.push(entry);
      continue;
    }
    for (const resolver of Object.values(entry) as unknown[]) {
      if (typeof resolver !== "function") continue;
      const value = await (resolver as (i: unknown, c: unknown) => unknown)(
        {},
        ctxWithThesis(),
      );
      if (typeof value === "string") out.push(value);
    }
  }
  return out;
}

describe("Phase 6 blind-pipeline invariant", () => {
  const presetNames = Object.keys(presetDefs).filter(
    (name) => name !== "userThesis",
  );

  for (const name of presetNames) {
    it(`the "${name}" preset never injects the user thesis`, async () => {
      const rendered = await renderPresetContext(presetDefs[name]);
      const joined = rendered.join("\n");
      expect(joined).not.toContain(THESIS_SENTINEL);
      expect(joined).not.toContain(RATIONALE_SENTINEL);
      expect(joined).not.toContain("<userThesis>");
    });
  }

  it("the core preset specifically never references the user thesis", async () => {
    const rendered = await renderPresetContext(presetDefs.core);
    const joined = rendered.join("\n");
    expect(joined).not.toContain(THESIS_SENTINEL);
    expect(joined).not.toContain("<userThesis>");
    // Sanity: the core preset DOES still emit its own ticker context, so the
    // walker is actually exercising resolvers (not silently rendering nothing).
    expect(joined).toContain("NVDA");
  });

  it("positive control — the userThesis preset DOES surface the thesis", async () => {
    const rendered = await renderPresetContext(presetDefs.userThesis);
    const joined = rendered.join("\n");
    expect(joined).toContain(THESIS_SENTINEL);
    expect(joined).toContain(RATIONALE_SENTINEL);
    expect(joined).toContain("<userThesis>");
  });
});
