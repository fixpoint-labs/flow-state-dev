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

/** Lower-case, strip every non-alphanumeric run to a single space, trim. */
export function normalizeEntityName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The distinctive tokens of a company name: 4+ characters, minus corporate-form
 * boilerplate. Returns an empty set for a name made only of short or generic
 * tokens (`XP Inc.`), which the caller must read as "no usable name signal"
 * rather than "matches nothing".
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
  /** Distinctive name tokens, precomputed. May be empty (short-token names). */
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

/** Best-effort hostname, `www.` stripped. Null on an unparseable URL. */
function hostOf(url: string | null): string | null {
  if (url === null || url === "") return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
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
 * True when `text` names the subject — the ticker as a standalone token, or
 * any distinctive token of the company name. Substring matching is deliberately
 * avoided (token equality only), so `marks` does not match `marketwatch`.
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
  for (const t of subject.nameTokens) if (tokens.has(t)) return true;
  return false;
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
 */
export function publisherIsSubject(
  publisher: string | null,
  subject: SubjectEntity,
): boolean {
  if (publisher === null || subject.websiteHost === null) return false;
  const p = publisher.replace(/^www\./, "").toLowerCase();
  return p === subject.websiteHost || p.endsWith(`.${subject.websiteHost}`);
}
