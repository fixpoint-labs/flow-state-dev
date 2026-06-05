/**
 * Web-enrichment helpers for the Company Profile analyst.
 *
 * Two backstops for the description gap when structured providers
 * (Finnhub, Yahoo) return null:
 *
 *   - `fetchWebsiteMetaDescription` pulls `<meta name="description">` and
 *     `<meta property="og:description">` from the company's homepage. The
 *     description meta tag is what the company says about itself in a
 *     single sentence — exactly the grounding signal we want.
 *
 *   - `searchCompanyWeb` runs a generic web search for the company name
 *     via `@flow-state-dev/tools/search`'s auto-detected provider
 *     (Tavily → Exa → Perplexity → Serper → Brave → Perplexity-Sonar)
 *     and returns the top snippets. Independent third-party perspective.
 *
 * Both throw on any failure — the calling tool wraps each in
 * `Promise.allSettled` and degrades to `null` so a missing provider key
 * never blocks the analyst.
 */
import { resolveProvider } from "@flow-state-dev/tools/search";

/** Fetch the homepage HTML and extract the `<meta>` description tags.
 *  Returns the combined description text (`og:description` preferred when
 *  longer than `name="description"`), or `null` if neither tag is present.
 *  Throws on network failure / non-2xx so callers can fall through. */
export async function fetchWebsiteMetaDescription(
  url: string,
): Promise<string | null> {
  const res = await fetch(url, {
    redirect: "follow",
    // Many corporate homepages serve a stripped page or 403 to non-browser
    // user agents. A standard UA string keeps the response useful.
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; flow-state-dev/trading-desk; +https://github.com/fixpoint-labs/flow-state-dev)",
      Accept: "text/html,application/xhtml+xml",
    },
    // Cap the read so a slow site doesn't stall the analyst.
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`website fetch failed: HTTP ${res.status} for ${url}`);
  }
  // Read up to 256KB — meta tags live in <head>, well within the first chunk.
  // Avoids buffering megabytes of body HTML for sites that put marketing
  // assets above the fold.
  const html = (await res.text()).slice(0, 256 * 1024);
  const meta = extractMetaDescription(html);
  const og = extractMetaProperty(html, "og:description");
  // Prefer the longer of the two — og:description is often more
  // narrative; name="description" is sometimes a SEO blurb.
  const candidates = [meta, og].filter((s): s is string => s !== null && s.length > 0);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

/** Run a web search for the company and return the top snippets in a
 *  schema-stable shape. Returns `null` only on resolver failure (no key
 *  configured for any provider). Empty array means the search ran but
 *  returned nothing. */
export async function searchCompanyWeb(
  query: string,
  maxResults = 5,
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  // `resolveProvider` throws when no provider key is set; let it propagate.
  const { adapter, apiKey } = resolveProvider({});
  const output = await adapter.search(query, {
    maxResults,
    searchDepth: "basic",
    topic: "general",
    apiKey,
  });
  return output.results.map((r: { title: string; url: string; snippet: string }) => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet,
  }));
}

/** Extract the content of `<meta name="description" content="...">`.
 *  Tolerant to attribute order and single/double quotes. */
function extractMetaDescription(html: string): string | null {
  // Two passes: attribute order can be `name`-then-`content` or reversed.
  const patterns = [
    /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i,
    /<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m !== null) return decodeHtmlEntities(m[1].trim());
  }
  return null;
}

/** Extract a `<meta property="...">` (Open Graph and similar). */
function extractMetaProperty(html: string, property: string): string | null {
  const safe = property.replace(/[^a-z0-9:_-]/gi, "");
  const patterns = [
    new RegExp(`<meta\\s+property=["']${safe}["']\\s+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta\\s+content=["']([^"']+)["']\\s+property=["']${safe}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m !== null) return decodeHtmlEntities(m[1].trim());
  }
  return null;
}

/** Minimal HTML entity decode for the handful of entities that commonly
 *  appear in meta descriptions. The full set isn't needed — meta tags
 *  are short and mostly plain text. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}
