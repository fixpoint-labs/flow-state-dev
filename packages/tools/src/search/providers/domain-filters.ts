/**
 * Shared encodings of `includeDomains` / `excludeDomains` for providers that
 * have no first-class include/exclude filter fields.
 */

/**
 * The query with the domain filters written as `site:` / `-site:` operators,
 * as Google (Serper) and Brave read them. Several include domains are
 * OR-grouped, because the engine ANDs bare `site:` terms; excludes stay
 * AND-chained, since every `-site:` must hold.
 */
export function withSiteOperators(
  query: string,
  includeDomains: readonly string[] = [],
  excludeDomains: readonly string[] = []
): string {
  const includeFilters = includeDomains.map((d) => `site:${d}`);
  const includeClause =
    includeFilters.length > 1
      ? `(${includeFilters.join(" OR ")})`
      : includeFilters.join("");
  const siteFilters = [
    includeClause,
    ...excludeDomains.map((d) => `-site:${d}`),
  ].filter(Boolean);
  return siteFilters.length ? `${query} ${siteFilters.join(" ")}` : query;
}

/**
 * Perplexity's `search_domain_filter` (Search API and Sonar): an allowlist or
 * a denylist, never both. With include domains it is the allowlist alone, so
 * an exclude inside an included domain is not applied (results wider than
 * asked, rather than an invalid request). Otherwise a denylist of `-`-prefixed
 * domains; empty when no filter is set, so callers can omit the field.
 */
export function perplexityDomainFilter(
  includeDomains: readonly string[] = [],
  excludeDomains: readonly string[] = []
): string[] {
  if (includeDomains.length > 0) return [...includeDomains];
  return excludeDomains.map((d) => `-${d}`);
}
