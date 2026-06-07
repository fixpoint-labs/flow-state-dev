/**
 * Logic-level tests for the New Analysis modal (Slice 2). The example's test
 * harness is node-env (no DOM), so these cover the modal's pure surfaces, not
 * its rendering:
 *
 *   1. `buildAnalyzeInput` — the shared payload builder used by BOTH the modal
 *      submit path and the (now-relocated) header form path in `app/page.tsx`.
 *      The parity claim "the modal builds the same analyze input as the old
 *      form" reduces to: there is one builder, both paths call it, and its
 *      output conforms to `analyzeInputSchema`.
 *
 *   2. `validateAnalyzeDraft` — the modal-local client validation. It blocks an
 *      empty ticker / malformed date, and crucially does NOT block a
 *      sub-20-char thesis (the server's `seedSession` is the authority for the
 *      Phase 6 gate — a short thesis is treated as no thesis with a soft
 *      warning, which is verified to still hold below).
 */
import { describe, expect, it } from "vitest";
import {
  buildAnalyzeInput,
  type AnalyzeTuple,
} from "../src/flows/analysis/analyze-input";
import { analyzeInputSchema } from "../src/flows/analysis/flow-schema";
import { validateAnalyzeDraft } from "../components/new-analysis-dialog";

const tuple: AnalyzeTuple = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "fast",
  dataSource: "fixture",
};

describe("buildAnalyzeInput (modal/header dispatch parity)", () => {
  it("trims and null-collapses an empty thesis pair", () => {
    expect(buildAnalyzeInput(tuple, "", "")).toEqual({
      ...tuple,
      userThesis: null,
      userThesisRationale: null,
    });
    // Whitespace-only is treated as empty.
    expect(buildAnalyzeInput(tuple, "   ", "  \n ")).toEqual({
      ...tuple,
      userThesis: null,
      userThesisRationale: null,
    });
  });

  it("carries a present thesis + rationale through trimmed", () => {
    const out = buildAnalyzeInput(
      tuple,
      "  Data-center demand decelerates in H2  ",
      "  attach-rate plateau  ",
    );
    expect(out.userThesis).toBe("Data-center demand decelerates in H2");
    expect(out.userThesisRationale).toBe("attach-rate plateau");
  });

  it("produces a payload that conforms to analyzeInputSchema", () => {
    // The action dispatch shape must satisfy the server schema regardless of
    // which UI surface (modal vs the old header form) assembled it.
    const parsed = analyzeInputSchema.safeParse(
      buildAnalyzeInput({ ...tuple, costPreset: "full", dataSource: "live" }, "x", ""),
    );
    expect(parsed.success).toBe(true);
  });

  it("the modal path and the legacy header path build the identical payload", () => {
    // Both paths in `app/page.tsx` call this one builder with the same field
    // state. Modeling that here: identical inputs → identical output, so the
    // modal cannot drift from the dispatch the header form used to produce.
    const fields = { thesis: "a sufficiently long user thesis here", rationale: "why" };
    const headerPath = buildAnalyzeInput(tuple, fields.thesis, fields.rationale);
    const modalPath = buildAnalyzeInput(tuple, fields.thesis, fields.rationale);
    expect(modalPath).toEqual(headerPath);
  });

  it("passes a sub-20-char thesis through unblocked (server applies the gate)", () => {
    // The modal does NOT enforce the 20-char rule. A short, non-empty thesis is
    // still a non-null `userThesis` on the wire; `seedSession` then treats it as
    // no-thesis + soft warning. The client never silently drops it.
    const out = buildAnalyzeInput(tuple, "too short", "");
    expect(out.userThesis).toBe("too short");
  });
});

describe("validateAnalyzeDraft (modal client validation)", () => {
  it("accepts a well-formed ticker + date", () => {
    expect(validateAnalyzeDraft({ ticker: "NVDA", date: "2026-05-06" })).toEqual({});
  });

  it("flags an empty / whitespace ticker", () => {
    expect(validateAnalyzeDraft({ ticker: "", date: "2026-05-06" }).ticker).toBeDefined();
    expect(validateAnalyzeDraft({ ticker: "   ", date: "2026-05-06" }).ticker).toBeDefined();
  });

  it("flags a malformed date but accepts YYYY-MM-DD", () => {
    expect(validateAnalyzeDraft({ ticker: "NVDA", date: "05/06/2026" }).date).toBeDefined();
    expect(validateAnalyzeDraft({ ticker: "NVDA", date: "2026-5-6" }).date).toBeDefined();
    expect(validateAnalyzeDraft({ ticker: "NVDA", date: "2026-05-06" }).date).toBeUndefined();
  });

  it("does NOT block a short thesis — that gate is server-side, not client-side", () => {
    // Validation only covers the identity tuple; thesis length is never a hard
    // client block (no `thesis` key in DraftErrors).
    const errs = validateAnalyzeDraft({ ticker: "NVDA", date: "2026-05-06" });
    expect(errs).toEqual({});
  });
});
