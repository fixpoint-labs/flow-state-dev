/**
 * Subject-entity identity primitives (FIX-779).
 *
 * Pure, IO-free string matching used to answer one question: does this piece
 * of free text actually talk about the company we are analysing? Web-search
 * snippets drift to the wrong entity on thin or ambiguous tickers (a ticker
 * symbol that collides with a company-name fragment, a recent listing with
 * little coverage), and a snippet about a different issuer that reaches an
 * analyst prompt is absorbed as evidence.
 *
 * Deliberately coarse. This is a contamination guard, not a semantic
 * classifier: it asks whether the subject is *named* in the text, and says
 * "unknown" rather than guessing when it has no name to match against.
 *
 * `namesAgree` (the FIX-898 recovered-filing gate) shares `normalizeEntityName`
 * with this module but keeps its own, looser token rule — see the note there.
 */

/**
 * Corporate-form and boilerplate tokens that carry no identifying signal.
 * `Black Hills Corporation` and `Black Hills Holdings Inc` must not agree with
 * an unrelated `… Corporation` purely on the form suffix.
 */
const GENERIC_NAME_TOKENS = new Set([
  "incorporated",
  "corp",
  "corporation",
  "company",
  "holding",
  "holdings",
  "group",
  "limited",
  "public",
  "international",
  "trust",
  "fund",
  "class",
  "common",
  "stock",
  "shares",
  "ordinary",
]);

/**
 * Name tokens that also carry a routine, NON-COMPANY meaning in financial prose.
 * `Target Corporation`'s only surviving token is `target`, and "raises the price
 * target" appears in coverage of every issuer there is — so a lone `target` is
 * not evidence that a snippet is about Target. Same for `energy`, `growth`,
 * `capital`, `first`, `value`.
 *
 * These are not dropped from the token set (a name that is entirely ordinary
 * words still HAS an identity — see `entityNameTokens`); they are demoted at
 * match time: an ordinary token verifies only in the company of a second name
 * token, never alone. `textMentionsEntity` owns that rule.
 *
 * The line is deliberately drawn at DIFFERENT-MEANING collisions, not at
 * category nouns. `semiconductor` stays distinctive: a snippet using it is at
 * least in the subject's own sector, which is the same adjacency the macro /
 * market discovery exemption already accepts, and demoting it would cost real
 * recall on issuers whose name IS the canonical industry term.
 */
const ORDINARY_NAME_TOKENS = new Set([
  "advisors",
  "american",
  "brands",
  "capital",
  "communications",
  "core",
  "data",
  "digital",
  "energy",
  "enterprises",
  "equity",
  "estate",
  "finance",
  "financial",
  "first",
  "general",
  "global",
  "growth",
  "health",
  "income",
  "index",
  "industries",
  "management",
  "market",
  "markets",
  "materials",
  "media",
  "national",
  "partners",
  "power",
  "products",
  "property",
  "real",
  "resources",
  "sector",
  "security",
  "select",
  "services",
  "solutions",
  "systems",
  "target",
  "technologies",
  "technology",
  "united",
  "value",
  "ventures",
  "works",
]);

/** Lower-case, strip every non-alphanumeric run to a single space, trim. */
export function normalizeEntityName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The identifying tokens of a company name: 4+ characters, minus corporate-form
 * boilerplate. Returns an empty set for a name made only of short or generic
 * tokens (`XP Inc.`), which the caller must read as "no usable name signal"
 * rather than "matches nothing".
 *
 * Ordinary-word tokens (`target`, `energy`) are KEPT here and demoted at match
 * time instead: they are part of the name, they just cannot carry it alone.
 * Filtering them out here would instead make a name like `Target Corporation`
 * resolve to no identity at all, turning the whole guard off for it.
 */
export function entityNameTokens(name: string): Set<string> {
  return new Set(
    normalizeEntityName(name)
      .split(" ")
      .filter((t) => t.length >= 4 && !GENERIC_NAME_TOKENS.has(t)),
  );
}

/** The resolved identity of the run's subject, as far as we know it. */
export type SubjectEntity = {
  /** The requested ticker, upper-cased. */
  ticker: string;
  /** Conformed company name from the resolved profile. Never empty. */
  name: string;
  /** The company's own site hostname (`nvidia.com`), when the profile carries
   *  one — a first-party publisher is the subject by definition. */
  websiteHost: string | null;
  /** Identifying name tokens, precomputed. May be empty (short-token names). */
  nameTokens: Set<string>;
};

/**
 * Build a subject identity from a resolved company profile. Returns `null`
 * when there is no trustworthy name to match against — an unavailable profile,
 * an empty name, or a name with no distinctive tokens. A null subject must
 * disable the check, never fail it closed: dropping every snippet because we
 * could not identify the company would be a worse failure than the one this
 * guards against.
 */
export function subjectEntityFromProfile(
  ticker: string,
  profile: { source?: unknown; name?: unknown; website?: unknown } | null | undefined,
): SubjectEntity | null {
  if (profile == null || profile.source === "unavailable") return null;
  const name = typeof profile.name === "string" ? profile.name.trim() : "";
  if (name === "") return null;
  const nameTokens = entityNameTokens(name);
  if (nameTokens.size === 0) return null;
  return {
    ticker: ticker.toUpperCase(),
    name,
    websiteHost: hostOf(typeof profile.website === "string" ? profile.website : null),
    nameTokens,
  };
}

/**
 * Best-effort hostname, `www.` stripped. Null on an unparseable URL — and null
 * when the profile's site is a page WITHIN a host rather than the host itself.
 *
 * A fund's profile site is typically a product page on its sponsor's shared
 * domain (`ishares.com/us/products/239726/…`). Reducing that to `ishares.com`
 * would make every page about every other fund in the family first-party
 * evidence for this one — the family is not the member. A path is the only
 * signal available that the host is shared, so a profile carrying one gives up
 * the publisher shortcut and falls back to ticker / name matching, which is
 * what actually distinguishes one fund from its siblings.
 */
function hostOf(url: string | null): string | null {
  if (url === null || url === "") return null;
  try {
    const parsed = new URL(url);
    if (parsed.pathname !== "" && parsed.pathname !== "/") return null;
    return parsed.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Tokenize on non-alphanumeric runs, PRESERVING case, as a padded string so a
 *  multi-token sequence can be matched with `includes` without regex escaping. */
function casedTokenRun(text: string): string {
  return ` ${text.split(/[^A-Za-z0-9]+/).filter((t) => t !== "").join(" ")} `;
}

/**
 * True when `text` names the subject — the ticker as a standalone token, a
 * distinctive token of the company name, or two of its ordinary-word tokens
 * together. Substring matching is deliberately avoided (token equality only),
 * so `marks` does not match `marketwatch`.
 *
 * **An ordinary-word name token never verifies alone.** `Target Corporation`
 * reduces to `target`, and "the analyst raises the price target" is prose about
 * any issuer at all; accepting it would verify a Tesla article as evidence about
 * Target. `energy`, `growth`, `capital`, `first` behave the same way. Requiring
 * a second name token costs recall on issuers whose entire name is one ordinary
 * word — a genuine article that names such a company only in lower case, and
 * carries neither the uppercase ticker nor a first-party domain, now drops. The
 * alternative is worse in the direction this guard exists to close.
 *
 * **The ticker match is case-SENSITIVE; the name match is not.** Plenty of
 * tickers are ordinary words — `ON`, `IT`, `ALL`, `CAT`, `KEY`, `GAP`. Matching
 * those case-insensitively lets routine prose ("… guidance depends *on* demand")
 * verify any result at all, which would silently disable this guard for exactly
 * the ambiguous symbols whose search results are most likely to be contaminated.
 * Requiring the uppercase form costs a narrow slice of recall — a result whose
 * ONLY mention of the subject is a lower-case ticker in a URL slug, with the
 * company unnamed in both title and snippet — and that item is weak evidence
 * anyway. `$NVDA` matches for free: `$` is a token delimiter.
 *
 * Name tokens stay case-insensitive: they are 4+ characters and stripped of
 * corporate-form boilerplate, so they do not collide with ordinary prose the way
 * a two-letter symbol does.
 */
export function textMentionsEntity(text: string, subject: SubjectEntity): boolean {
  // Padded-token-run for the ticker so a dotted class share (`BRK.B` → `BRK B`)
  // matches as a token sequence rather than a single token.
  const tickerRun = casedTokenRun(subject.ticker);
  if (tickerRun.trim() !== "" && casedTokenRun(text).includes(tickerRun)) return true;
  const normalized = normalizeEntityName(text);
  if (normalized === "") return false;
  const tokens = new Set(normalized.split(" "));
  let ordinaryMatches = 0;
  for (const t of subject.nameTokens) {
    if (!tokens.has(t)) continue;
    // A distinctive token carries the name on its own; an ordinary one only
    // counts toward the pair.
    if (!ORDINARY_NAME_TOKENS.has(t)) return true;
    ordinaryMatches += 1;
  }
  return ordinaryMatches >= 2;
}

/**
 * True when a publisher domain is the subject's own site — a first-party page
 * is about the subject even when the extract never names it.
 *
 * Subdomains of the configured host count: press releases and filings live on
 * `investor.` / `newsroom.` / `ir.` hosts, and those pages routinely carry a
 * generic title ("Third Quarter 2026 Results") that names no company. Without
 * this, the most authoritative evidence the desk can get would be dropped as an
 * entity mismatch. The match is anchored on a leading dot, so `evilnvidia.com`
 * and `nvidia.com.attacker.net` are still third-party.
 *
 * Always false when the profile's site was a page on a shared host rather than
 * a host of its own — see `hostOf`.
 */
export function publisherIsSubject(
  publisher: string | null,
  subject: SubjectEntity,
): boolean {
  if (publisher === null || subject.websiteHost === null) return false;
  const p = publisher.replace(/^www\./, "").toLowerCase();
  return p === subject.websiteHost || p.endsWith(`.${subject.websiteHost}`);
}
