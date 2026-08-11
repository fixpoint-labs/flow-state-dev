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
 * match time: an ordinary token verifies only ADJACENT to a second ordinary name
 * token, never alone and never merely co-occurring somewhere in the same text.
 * `textMentionsEntity` owns that rule.
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

/**
 * Short tokens that describe a company's FORM or a security's STRUCTURE rather
 * than its identity. `entityNameTokens`'s 4+ character rule already drops `inc`
 * / `ltd` before `GENERIC_NAME_TOKENS` is ever consulted, so that set never had
 * to list them; the short-name pass has no length floor to hide behind.
 * Upper-case because that pass is case-sensitive.
 *
 * **This list is defense-in-depth, NOT the primary defence.** A curated denylist
 * of category labels fails OPEN — an instrument type nobody thought of becomes
 * an identity — which is the wrong default for a contamination guard. The
 * primary rule is structural and lives in `shortNameTokens`: the short pass runs
 * only for a name with no distinctive long token at all. Every name carrying one
 * of these classifiers also carries a real name word (`iShares … ETF`,
 * `Vanguard … ETF`, `Taiwan Semiconductor … ADR`), so the structural rule
 * already excludes them. This set only catches the degenerate leftover — a name
 * that is ALL short tokens and includes a classifier (`XP ETF`).
 */
const SHORT_GENERIC_NAME_TOKENS = new Set([
  // Corporate forms.
  "AB",
  "AG",
  "AS",
  "BV",
  "CO",
  "INC",
  "KK",
  "LLC",
  "LP",
  "LTD",
  "NV",
  "OY",
  "PLC",
  "PTE",
  "PTY",
  "SA",
  "SE",
  "SPA",
  // Security structures and instrument wrappers.
  "ADR",
  "ADS",
  "BDC",
  "CEF",
  "ETC",
  "ETF",
  "ETN",
  "ETP",
  "GDR",
  "GDS",
  "MLP",
  "ORD",
  "UIT",
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

/**
 * The SHORT identifying tokens of a company name — `3M`, `XP`, `BP` — kept in
 * their original case and matched case-sensitively, exactly like the ticker.
 *
 * These exist because `entityNameTokens` drops everything under 4 characters,
 * which leaves `3M Company` and `XP Inc.` with no name signal at all. Without
 * them the guard has nothing but the ticker for such issuers, and coverage says
 * "3M" far more often than it says "MMM".
 *
 * **Case-sensitivity is the whole safety argument, and it is the ticker rule's.**
 * A 2-character token matched case-insensitively is the `ON` / `IT` hazard that
 * made the ticker rule case-sensitive in the first place; `xp` and `3m` in
 * running prose must not verify anything. Requiring the upper-case form leaves
 * the same residual the ticker rule already accepts (an ALL-CAPS headline can
 * collide) and no new one — this pass is deliberately no more permissive than
 * the rule it copies.
 *
 * Restricted to 2–3 characters and all-caps: a single letter (`T`) is too noisy
 * to carry identity, and the all-caps test is what excludes the mixed-case
 * corporate forms (`Inc`, `Co`, `The`) without needing to enumerate them.
 *
 * **A FALLBACK, not an additional signal — this is what keeps category labels
 * out.** The pass runs only when `entityNameTokens` is empty. Read the two
 * halves of that together: the short pass exists because `3M Company` and
 * `XP Inc.` have no long token to identify them, so a name that HAS one never
 * needed it. Without the restriction, `iShares Core S&P 500 ETF` yields `ETF`,
 * and every result containing the routine label "ETF" verifies as evidence about
 * that one fund — far broader than any sibling-fund problem.
 *
 * The structural rule is what does the work; enumerating `ETF` / `ETN` / `ADR`
 * in a denylist would fail open on the first instrument type nobody listed. Note
 * the shape: a name carrying a classifier is a fund or a depositary receipt OF
 * something, so it always carries that something's name too — which is exactly
 * why "has a long token" separates the two populations cleanly.
 */
export function shortNameTokens(name: string): Set<string> {
  // Not merely "prefer long tokens" — the short pass is OFF entirely when a
  // distinctive long token exists, so a trailing classifier can never become an
  // identity for a name that has a real one.
  if (entityNameTokens(name).size > 0) return new Set();
  return new Set(
    name
      .split(/[^A-Za-z0-9]+/)
      .filter(
        (t) =>
          t.length >= 2 &&
          t.length <= 3 &&
          // All-caps, and containing at least one letter (excludes `35`).
          t === t.toUpperCase() &&
          t !== t.toLowerCase() &&
          !SHORT_GENERIC_NAME_TOKENS.has(t),
      ),
  );
}

/** The resolved identity of the run's subject, as far as we know it. */
export type SubjectEntity = {
  /** The requested ticker, upper-cased. Matched case-sensitively. */
  ticker: string;
  /** Conformed company name from the resolved profile. May be empty when the
   *  provider returned a profile with no name — the ticker still identifies. */
  name: string;
  /** The company's own site hostname (`nvidia.com`), when the profile carries
   *  one — a first-party publisher is the subject by definition. */
  websiteHost: string | null;
  /** Identifying 4+ character name tokens, lower-cased, matched
   *  case-insensitively. May be empty (`3M Company`, `XP Inc.`). */
  nameTokens: Set<string>;
  /** Short all-caps name tokens (`3M`), matched case-sensitively. Populated
   *  ONLY when `nameTokens` is empty — the fallback that gives a short-named
   *  issuer a name signal, never an extra signal alongside a real one. */
  shortNameTokens: Set<string>;
};

/**
 * Build a subject identity from a resolved company profile. Returns `null` only
 * when the profile itself never resolved, or when it resolved to an identity
 * that could not match anything at all.
 *
 * **A thin name is not an absent identity.** This used to return `null` the
 * moment `entityNameTokens` came back empty, which is the case for every issuer
 * whose name is short or all-boilerplate — `XP Inc.`, `3M Company`. A null
 * subject makes `applyEntityCheck` tag the payload `unchecked` and keep every
 * result, so those issuers received NONE of this guard's protection, and short
 * ambiguous symbols are precisely the ones whose searches pull another
 * company's pages. The identity was never actually missing: the ticker, the
 * first-party domain, and the short name tokens were all sitting right here.
 * This is the same correction made for ordinary-word tokens, which are demoted
 * at match time rather than filtered out for exactly this reason — the
 * principle was right, it just was not applied to the inputs.
 *
 * The one case that still returns null is a subject with NO signal whatsoever:
 * no ticker, no host, no name token of either kind. Such a subject matches
 * nothing, so every result would be dropped — and dropping every snippet
 * because we could not identify the company is a worse failure than the one
 * this guards against. An unresolved or `"unavailable"` profile stays null for
 * the same reason it always did: we would be running the check on a ticker
 * nothing has confirmed, and the honest answer there is `unchecked`.
 */
export function subjectEntityFromProfile(
  ticker: string,
  profile: { source?: unknown; name?: unknown; website?: unknown } | null | undefined,
): SubjectEntity | null {
  if (profile == null || profile.source === "unavailable") return null;
  const name = typeof profile.name === "string" ? profile.name.trim() : "";
  const normalizedTicker = ticker.toUpperCase().trim();
  const nameTokens = entityNameTokens(name);
  const shortTokens = shortNameTokens(name);
  const websiteHost = hostOf(typeof profile.website === "string" ? profile.website : null);
  // Nothing to match on at all — see the note above on why this must disable
  // the check rather than fail it closed.
  if (
    normalizedTicker === "" &&
    websiteHost === null &&
    nameTokens.size === 0 &&
    shortTokens.size === 0
  ) {
    return null;
  }
  return {
    ticker: normalizedTicker,
    name,
    websiteHost,
    nameTokens,
    shortNameTokens: shortTokens,
  };
}

/**
 * A path segment that marks a site ROOT rather than a page within the site: a
 * locale or region prefix (`en`, `en-us`, `us`, `ir`) or a default document.
 *
 * This is the narrow half of the shared-host test below. It recognises the
 * shapes that are definitely NOT product-specific and treats everything else as
 * a page — so an unrecognised path keeps the conservative behaviour rather than
 * being waved through.
 */
function isRootPathSegment(segment: string): boolean {
  const s = segment.toLowerCase();
  return (
    s === "home" ||
    /^(index|default)\.(html?|php|aspx?|jsp)$/.test(s) ||
    /^[a-z]{2}([-_][a-z]{2})?$/.test(s)
  );
}

/**
 * Best-effort hostname, `www.` stripped. Null on an unparseable URL — and null
 * when the profile's site is a PRODUCT PAGE within a shared host rather than
 * that company's own site.
 *
 * A fund's profile site is typically a product page on its sponsor's shared
 * domain (`ishares.com/us/products/239726/…`). Reducing that to `ishares.com`
 * would make every page about every other fund in the family first-party
 * evidence for this one — the family is not the member.
 *
 * **The test is the shape of the path, not its mere presence.** Requiring a
 * bare host was too blunt: an ordinary corporate site published at a locale or
 * section root (`company.com/en/`, `company.com/us/en/`, `company.com/index.html`)
 * also lost the shortcut, and it lost it exactly where the shortcut is
 * load-bearing. First-party matching exists for the release titled "Third
 * Quarter 2026 Results" that names no company anywhere in its title or snippet —
 * so removing it for those issuers discarded the most authoritative evidence the
 * desk can get, on precisely the items the text check cannot rescue.
 *
 * So a path made ENTIRELY of root-ish segments is still that company's own site;
 * anything else (a product path, any deeper page) gives up the shortcut and
 * falls back to ticker / name matching, which is what actually distinguishes one
 * fund from its siblings.
 *
 * This narrows the ambiguity, it does not remove it: a fund whose profile URL is
 * a bare sponsor root would still be read as first-party for the whole family.
 * That direction is chosen deliberately — see the note on `publisherIsSubject`.
 */
function hostOf(url: string | null): string | null {
  if (url === null || url === "") return null;
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter((s) => s !== "");
    // `[].every` is true, so a bare host (`""` / `"/"`) still resolves.
    if (!segments.every(isRootPathSegment)) return null;
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
 * short all-caps name token (`3M`), a distinctive token of the company name, or
 * two of its ordinary-word tokens ADJACENT to one another. Substring matching is
 * deliberately avoided (token equality only), so `marks` does not match
 * `marketwatch`.
 *
 * **An ordinary-word name token never verifies alone.** `Target Corporation`
 * reduces to `target`, and "the analyst raises the price target" is prose about
 * any issuer at all; accepting it would verify a Tesla article as evidence about
 * Target. `energy`, `growth`, `capital`, `first` behave the same way.
 *
 * **Nor do two of them verify by merely co-occurring.** `text` here is the
 * concatenated title + snippet + URL of one search result, so "somewhere in this
 * text" spans unrelated sentences. `American Financial Group` reduces to
 * `american` + `financial`, and "American consumers face financial pressure as
 * rates rise" carries both while being about neither — bag-of-words
 * co-occurrence is not evidence the prose is about the issuer. So the two must
 * appear as a CONTIGUOUS run: `american financial` verifies, `american … financial`
 * does not. Order is not required (a name is written back-to-front often enough),
 * adjacency is. This costs recall on an article that splits the name across other
 * words, and on issuers whose entire name is one ordinary word — a genuine
 * article naming such a company only in lower case, carrying neither the
 * uppercase ticker nor a first-party domain, drops. The alternative is worse in
 * the direction this guard exists to close.
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
 * Name tokens stay case-insensitive: a company is named in real coverage in
 * whatever case the outlet's style demands, so requiring an exact case would drop
 * most genuine mentions. Plenty of them DO collide with ordinary prose — being
 * 4+ characters and stripped of corporate-form boilerplate does not save
 * `target`, `financial`, or `energy`, which is why `ORDINARY_NAME_TOKENS` exists.
 * Casing could not separate them anyway: a headline capitalizes "Price Target".
 * The adjacency rule above is what handles that collision, not the case rule.
 */
export function textMentionsEntity(text: string, subject: SubjectEntity): boolean {
  // Padded-token-run for the ticker so a dotted class share (`BRK.B` → `BRK B`)
  // matches as a token sequence rather than a single token.
  const casedText = casedTokenRun(text);
  const tickerRun = casedTokenRun(subject.ticker);
  if (tickerRun.trim() !== "" && casedText.includes(tickerRun)) return true;
  // Short name tokens ride the same case-SENSITIVE run as the ticker, for the
  // same reason: `3m` in prose is not a mention of 3M.
  for (const t of subject.shortNameTokens) {
    if (casedText.includes(` ${t} `)) return true;
  }
  const normalized = normalizeEntityName(text);
  if (normalized === "") return false;
  // Ordered, because the ordinary-token rule is about adjacency; the set is the
  // membership index over the same sequence.
  const textTokens = normalized.split(" ");
  const tokens = new Set(textTokens);
  const matchedOrdinary = new Set<string>();
  for (const t of subject.nameTokens) {
    if (!tokens.has(t)) continue;
    // A distinctive token carries the name on its own; an ordinary one only
    // counts toward an adjacent pair.
    if (!ORDINARY_NAME_TOKENS.has(t)) return true;
    matchedOrdinary.add(t);
  }
  if (matchedOrdinary.size < 2) return false;
  // Two DISTINCT ordinary name tokens, side by side. A repeated single token is
  // one token of the name twice over, not two of them.
  for (let i = 1; i < textTokens.length; i += 1) {
    const prev = textTokens[i - 1] as string;
    const cur = textTokens[i] as string;
    if (prev !== cur && matchedOrdinary.has(prev) && matchedOrdinary.has(cur)) {
      return true;
    }
  }
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
 *
 * Always false when the profile's site was a PRODUCT PAGE on a shared host
 * rather than that company's own site — see `hostOf`, which decides that on the
 * shape of the path.
 *
 * **The direction chosen, stated plainly.** No test cleanly separates a shared
 * product host from an ordinary corporate site; the path shape is a proxy, not a
 * proof. Between the two failure directions — accepting a sibling fund's page as
 * this fund's evidence, or discarding a genuine first-party release — this
 * function errs toward DISCARDING on anything it does not positively recognise
 * as a site root. Contaminated evidence is read as fact and sizes a position; a
 * dropped release is a gap the analyst can see in its own `dataQuality`. The
 * residual is a fund whose profile URL is a bare sponsor root, which stays
 * wrongly first-party for its whole family; that is the family-token problem
 * tracked on FIX-1100, and the ticker is what carries fund identity regardless.
 */
export function publisherIsSubject(
  publisher: string | null,
  subject: SubjectEntity,
): boolean {
  if (publisher === null || subject.websiteHost === null) return false;
  const p = publisher.replace(/^www\./, "").toLowerCase();
  return p === subject.websiteHost || p.endsWith(`.${subject.websiteHost}`);
}
