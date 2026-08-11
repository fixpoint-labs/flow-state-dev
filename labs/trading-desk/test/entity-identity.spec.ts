/**
 * Tests for the subject-entity identity primitives (FIX-779).
 *
 * Intent encoded: this leaf decides whether a web-search result is about the
 * company being analysed. Two failure directions matter, and they are not
 * symmetric:
 *
 *   - a FALSE POSITIVE lets another issuer's earnings transcript into an
 *     analyst prompt as evidence — the bug this exists to close;
 *   - a FALSE NEGATIVE silently discards real context, so the leaf must return
 *     "no usable identity" (null) rather than guess when it has nothing solid
 *     to match on. A null subject disables the check upstream; it never fails
 *     it closed.
 */
import { describe, expect, it } from "vitest";
import {
  entityNameTokens,
  publisherIsSubject,
  subjectEntityFromProfile,
  textMentionsEntity,
  type SubjectEntity,
} from "../flows/analysis/lib/entity-identity";

const nvidia = subjectEntityFromProfile("NVDA", {
  source: "finnhub",
  name: "NVIDIA Corporation",
  website: "https://www.nvidia.com",
}) as SubjectEntity;

describe("entityNameTokens", () => {
  it("keeps the distinctive tokens and drops corporate-form boilerplate", () => {
    expect([...entityNameTokens("NVIDIA Corporation")]).toEqual(["nvidia"]);
    expect([...entityNameTokens("Black Hills Corporation")]).toEqual(["black", "hills"]);
  });

  it("drops the shared form suffix, so two unrelated issuers do not agree on it", () => {
    // Without the boilerplate filter, "Alpha Holdings" and "Beta Holdings"
    // would share a token and every result about either would verify as both.
    const alpha = entityNameTokens("Alpha Holdings Group Inc");
    const beta = entityNameTokens("Beta Holdings Group Inc");
    const shared = [...alpha].filter((t) => beta.has(t));
    expect(shared).toEqual([]);
  });
});

describe("subjectEntityFromProfile", () => {
  it("builds an identity from a resolved profile", () => {
    expect(nvidia.ticker).toBe("NVDA");
    expect(nvidia.name).toBe("NVIDIA Corporation");
    expect(nvidia.websiteHost).toBe("nvidia.com");
  });

  it("returns null for an unavailable profile — no identity to check against", () => {
    expect(
      subjectEntityFromProfile("NVDA", { source: "unavailable", name: "", website: null }),
    ).toBeNull();
    expect(subjectEntityFromProfile("NVDA", null)).toBeNull();
  });

  it("returns null when the name carries no distinctive tokens", () => {
    // `XP Inc.` is entirely short + boilerplate tokens. Checking snippets
    // against an empty token set would reject every legitimate result, so the
    // leaf reports "unknown identity" and lets the caller skip the check.
    expect(subjectEntityFromProfile("XP", { source: "yahoo", name: "XP Inc." })).toBeNull();
  });
});

describe("textMentionsEntity", () => {
  it("matches on the ticker as a standalone token", () => {
    expect(textMentionsEntity("Why NVDA is still cheap", nvidia)).toBe(true);
  });

  it("matches on a distinctive company-name token", () => {
    expect(
      textMentionsEntity("Nvidia's data-center mix keeps climbing", nvidia),
    ).toBe(true);
  });

  it("rejects a result about a different company — the FIX-779 failure", () => {
    expect(
      textMentionsEntity(
        "Black Hills Corp Q1 2026 earnings call transcript: management reiterates guidance",
        nvidia,
      ),
    ).toBe(false);
  });

  it("does not match on a substring collision", () => {
    // Token equality, not substring: a `marketwatch.com` byline must not verify
    // a subject whose name token is `marks`.
    const marks = subjectEntityFromProfile("MKS", {
      source: "finnhub",
      name: "Marks and Spencer Group plc",
    }) as SubjectEntity;
    expect(textMentionsEntity("marketwatch.com coverage of retail", marks)).toBe(false);
    expect(textMentionsEntity("Marks & Spencer trading update", marks)).toBe(true);
  });

  it("matches a dotted class-share ticker as a token sequence", () => {
    const brk = subjectEntityFromProfile("BRK.B", {
      source: "finnhub",
      name: "Berkshire Hathaway Inc",
    }) as SubjectEntity;
    expect(textMentionsEntity("BRK.B closes at a record", brk)).toBe(true);
  });

  it("does not let ordinary prose verify a word-shaped ticker", () => {
    // `ON` is a real ticker AND an English preposition. Matching the ticker
    // case-insensitively would verify essentially every snippet ever written,
    // silently disabling the guard for exactly the ambiguous symbols whose
    // search results are most likely to belong to someone else.
    const on = subjectEntityFromProfile("ON", {
      source: "finnhub",
      name: "ON Semiconductor Corporation",
    }) as SubjectEntity;
    expect(
      textMentionsEntity("Black Hills raised guidance on strong demand", on),
    ).toBe(false);
    // The real thing still verifies — by the uppercase ticker...
    expect(textMentionsEntity("ON beats on margin", on)).toBe(true);
    // ...by the cashtag form, which tokenizes the same way...
    expect(textMentionsEntity("$ON is breaking out", on)).toBe(true);
    // ...and by the distinctive name token, which stays case-insensitive.
    expect(textMentionsEntity("onsemi and other semiconductor names", on)).toBe(true);
  });
});

describe("publisherIsSubject", () => {
  it("treats the company's own domain as first-party", () => {
    expect(publisherIsSubject("nvidia.com", nvidia)).toBe(true);
    expect(publisherIsSubject("www.nvidia.com", nvidia)).toBe(true);
    expect(publisherIsSubject("reuters.com", nvidia)).toBe(false);
    expect(publisherIsSubject(null, nvidia)).toBe(false);
  });

  it("treats first-party subdomains as the subject", () => {
    // Press releases and filings live on `investor.` / `newsroom.` hosts and
    // routinely carry a title that names no company ("Third Quarter Results").
    // An exact-host match would drop the most authoritative evidence available.
    expect(publisherIsSubject("investor.nvidia.com", nvidia)).toBe(true);
    expect(publisherIsSubject("nvidianews.nvidia.com", nvidia)).toBe(true);
  });

  it("does not let a lookalike host impersonate the subject", () => {
    // The dot anchor is what separates a real subdomain from a suffix collision.
    expect(publisherIsSubject("evilnvidia.com", nvidia)).toBe(false);
    expect(publisherIsSubject("nvidia.com.attacker.net", nvidia)).toBe(false);
  });
});
