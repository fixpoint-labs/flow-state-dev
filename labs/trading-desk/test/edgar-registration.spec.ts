/**
 * Unit tests for registration/prospectus candidate selection (FIX-898).
 *
 * Intent: a newly listed issuer's S-1 / 424B* primaries are discoverable and
 * ranked (final prospectus > amendment > original), filed-on-or-before the
 * as-of date, WITHOUT disturbing the periodic 10-K/10-Q/8-K path. The selector
 * is pure, so the ranking is pinned here without a network fetch.
 */
import { describe, expect, it } from "vitest";
import {
  REGISTRATION_FORMS,
  selectRegistrationCandidates,
  type RecentSubmissions,
} from "../lib/providers/edgar-registration";

// A newly listed issuer's submissions: an original S-1, an amendment, the final
// priced prospectus (424B4), plus periodic noise that must be ignored.
const recent: RecentSubmissions = {
  form: ["8-K", "424B4", "S-1/A", "S-1", "10-K"],
  filingDate: ["2026-03-01", "2026-02-10", "2026-01-20", "2026-01-05", "2019-01-01"],
  accessionNumber: [
    "0000000000-26-000005",
    "0000000000-26-000004",
    "0000000000-26-000003",
    "0000000000-26-000002",
    "0000000000-19-000001",
  ],
  primaryDocument: ["ev.htm", "424b4.htm", "s1a.htm", "s1.htm", "10k.htm"],
};

describe("selectRegistrationCandidates", () => {
  it("returns registration primaries ranked final-prospectus-first, dropping periodic forms", () => {
    const got = selectRegistrationCandidates(recent, 1750000, "SpaceCo Exploration Inc.", "2026-05-06", 3);
    expect(got.map((c) => c.form)).toEqual(["424B4", "S-1/A", "S-1"]);
    // The 8-K and 10-K are never registration candidates.
    expect(got.some((c) => c.form === "8-K" || c.form === "10-K")).toBe(false);
    // The URL is a well-formed SEC Archives path with the de-hyphenated accession.
    expect(got[0].url).toBe(
      "https://www.sec.gov/Archives/edgar/data/1750000/000000000026000004/424b4.htm",
    );
    expect(got[0].cik).toBe(1750000);
    expect(got[0].companyName).toBe("SpaceCo Exploration Inc.");
  });

  it("excludes filings dated after the run's as-of date (no future information)", () => {
    // As-of before the 424B4 filed 2026-02-10: only the earlier S-1/A and S-1 qualify.
    const got = selectRegistrationCandidates(recent, 1750000, "SpaceCo", "2026-01-25", 3);
    expect(got.map((c) => c.form)).toEqual(["S-1/A", "S-1"]);
  });

  it("honors the candidate limit", () => {
    expect(selectRegistrationCandidates(recent, 1, "X", "2026-05-06", 1)).toHaveLength(1);
  });

  it("REGISTRATION_FORMS covers the S-1, full 424B, and F-1 families but not periodic forms", () => {
    expect(REGISTRATION_FORMS.has("424B4")).toBe(true);
    expect(REGISTRATION_FORMS.has("424B3")).toBe(true);
    expect(REGISTRATION_FORMS.has("424B5")).toBe(true);
    expect(REGISTRATION_FORMS.has("S-1")).toBe(true);
    expect(REGISTRATION_FORMS.has("F-1")).toBe(true);
    expect(REGISTRATION_FORMS.has("10-K")).toBe(false);
    expect(REGISTRATION_FORMS.has("8-K")).toBe(false);
  });
});
