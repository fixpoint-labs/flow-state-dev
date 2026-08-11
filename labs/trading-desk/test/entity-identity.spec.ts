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

  it("keeps the guard ON for a name with no 4+ character tokens", () => {
    // `XP Inc.` and `3M Company` reduce to nothing under the 4-char rule. This
    // used to return null, which tags every payload `unchecked` and RETAINS all
    // results — so the issuers most likely to pull another company's pages got
    // no protection at all. The identity was never missing: ticker, domain, and
    // the short all-caps name token were all present.
    const xp = subjectEntityFromProfile("XP", {
      source: "yahoo",
      name: "XP Inc.",
      website: "https://www.xpinc.com",
    }) as SubjectEntity;
    expect(xp).not.toBeNull();
    expect(xp.nameTokens.size).toBe(0);
    expect([...xp.shortNameTokens]).toEqual(["XP"]);
    expect(xp.websiteHost).toBe("xpinc.com");

    const mmm = subjectEntityFromProfile("MMM", {
      source: "finnhub",
      name: "3M Company",
    }) as SubjectEntity;
    expect(mmm).not.toBeNull();
    expect(mmm.nameTokens.size).toBe(0);
    // `Company` is boilerplate; `3M` is the identity coverage actually uses.
    expect([...mmm.shortNameTokens]).toEqual(["3M"]);
  });

  it("does not treat a short corporate form as an identity", () => {
    // `Siemens AG` must not resolve `AG` as a short name token — it is a
    // corporate form, and the all-caps test alone would let it through.
    const siemens = subjectEntityFromProfile("SIEGY", {
      source: "yahoo",
      name: "Siemens AG",
    }) as SubjectEntity;
    expect([...siemens.shortNameTokens]).toEqual([]);
    expect([...siemens.nameTokens]).toEqual(["siemens"]);
  });

  it("returns null only when nothing at all can be matched on", () => {
    // The remaining honest no-identity case: no ticker, no host, no name token
    // of either kind. Such a subject matches nothing, so running the check
    // would drop every result — worse than the contamination it guards against.
    expect(
      subjectEntityFromProfile("", { source: "yahoo", name: "Inc.", website: null }),
    ).toBeNull();
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

  it("does not let an ordinary finance word carry a company name alone", () => {
    // `Target Corporation` reduces to the single token `target`, which appears
    // in coverage of every issuer there is ("raises the price target"). Treating
    // it as a name match verifies a Tesla article as evidence about Target —
    // the FIX-779 failure with the guard's own matching as the vector.
    const target = subjectEntityFromProfile("TGT", {
      source: "finnhub",
      name: "Target Corporation",
      website: "https://www.target.com",
    }) as SubjectEntity;
    expect(
      textMentionsEntity("Tesla analyst raises the price target to $400", target),
    ).toBe(false);
    // The real thing still verifies by the uppercase ticker...
    expect(textMentionsEntity("TGT comparable sales beat", target)).toBe(true);
    // ...and by the first-party domain, which is why the recall cost is bounded.
    expect(publisherIsSubject("corporate.target.com", target)).toBe(true);
  });

  it("lets two ordinary tokens verify only when they are adjacent", () => {
    // No single token of `American Financial Group` identifies it. Two of them
    // side by side name the company; two of them merely PRESENT somewhere in the
    // text do not — `text` is the concatenated title + snippet + URL of one
    // result, so co-occurrence spans unrelated sentences.
    const afg = subjectEntityFromProfile("AFG", {
      source: "finnhub",
      name: "American Financial Group Inc",
    }) as SubjectEntity;
    expect(textMentionsEntity("American Financial posted a record quarter", afg)).toBe(
      true,
    );
    // The counterexample that falsified the co-occurrence rule: macro prose about
    // consumers and rates, about no issuer at all, carrying both name tokens far
    // apart. Under a bag-of-words pair rule this verified as evidence about AFG —
    // contaminated prose reaching the prompt through the guard meant to stop it.
    expect(
      textMentionsEntity(
        "American consumers face financial pressure as rates rise",
        afg,
      ),
    ).toBe(false);
    // One ordinary token alone is still not enough (the pre-existing rule).
    expect(textMentionsEntity("the American consumer is holding up", afg)).toBe(false);
    // Adjacency is order-agnostic — a name gets written back-to-front often
    // enough ("Financial American Group Inc" in a filings index).
    expect(textMentionsEntity("Financial American Group filed an 8-K", afg)).toBe(true);
    // A repeated SINGLE ordinary token is one name token twice, not two of them.
    expect(
      textMentionsEntity("American American Airlines cut its outlook", afg),
    ).toBe(false);
    // A URL slug that names the company still verifies — the normalizer splits
    // on the hyphens, so the run stays contiguous.
    expect(
      textMentionsEntity("Q3 results https://ex.com/american-financial-group-q3", afg),
    ).toBe(true);
  });

  it("matches a short name token case-sensitively, like the ticker", () => {
    // `3M Company` has no 4+ character token, so `3M` IS the name signal.
    // Coverage says "3M" far more often than "MMM", and without this the guard
    // would drop most genuine 3M articles the moment it started running.
    const mmm = subjectEntityFromProfile("MMM", {
      source: "finnhub",
      name: "3M Company",
    }) as SubjectEntity;
    expect(textMentionsEntity("3M lifts full-year guidance", mmm)).toBe(true);
    expect(textMentionsEntity("MMM declares a dividend", mmm)).toBe(true);
    // Case-sensitive for the same reason the ticker rule is: a 2-character
    // token matched loosely lets routine prose verify anything.
    expect(textMentionsEntity("the 3m distance was measured", mmm)).toBe(false);
    // And a genuinely unrelated company is now DROPPED rather than retained —
    // the whole point of keeping the guard on for short names.
    expect(textMentionsEntity("Tesla raises the price target", mmm)).toBe(false);
  });

  it("checks a short-named issuer against the wrong company's prose", () => {
    // The defect this closes, end to end: XP Inc. used to resolve to no
    // identity, so an unrelated result was retained as `unchecked` evidence.
    const xp = subjectEntityFromProfile("XP", {
      source: "yahoo",
      name: "XP Inc.",
    }) as SubjectEntity;
    expect(textMentionsEntity("XP Inc. posts record client assets", xp)).toBe(true);
    expect(textMentionsEntity("Nvidia's data-center mix keeps climbing", xp)).toBe(false);
    // Lower-case `xp` is ordinary prose ("gained xp"), not a mention.
    expect(textMentionsEntity("the player gained xp quickly", xp)).toBe(false);
  });

  it("still verifies a distinctive token with no adjacency requirement", () => {
    // The adjacency rule is scoped to ORDINARY tokens. A category noun like
    // `semiconductor` stays distinctive and carries the name on its own —
    // demoting it would cost `ON Semiconductor` name verification entirely,
    // since `ON` only matches upper-case.
    const on = subjectEntityFromProfile("ON", {
      source: "finnhub",
      name: "ON Semiconductor Corporation",
    }) as SubjectEntity;
    expect(
      textMentionsEntity("a semiconductor supplier raised guidance", on),
    ).toBe(true);
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

  it("gives up the shortcut when the profile site is a page on a shared host", () => {
    // A fund's site is a product page on its sponsor's domain. Reducing it to
    // the bare host makes every sibling fund's page first-party evidence for
    // this one — the family is not the member. So no host is resolved at all,
    // and identity falls to the ticker, which does distinguish siblings.
    const ivv = subjectEntityFromProfile("IVV", {
      source: "yahoo",
      name: "iShares Core S&P 500 ETF",
      website: "https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf",
    }) as SubjectEntity;
    expect(ivv.websiteHost).toBeNull();
    expect(publisherIsSubject("ishares.com", ivv)).toBe(false);
    expect(textMentionsEntity("IVV sees record inflows", ivv)).toBe(true);
  });
});
