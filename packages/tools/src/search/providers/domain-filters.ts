/**
 * The two ways a search adapter carries `includeDomains` / `excludeDomains`
 * to a provider that has no first-class filter field of its own, shared so
 * the providers that use the same form cannot drift apart.
 */

/**
 * The query with the domain filters written as `site:` / `-site:` operators,
 * the form Google (Serper) and Brave read in the query text. Several include
 * domains are OR-grouped, so the engine does not AND them.
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
 * Perplexity's `search_domain_filter` value, read by both its Search API and
 * Sonar: include domains as-is, exclude domains with a `-` prefix. Empty when
 * no filter is set, so callers can omit the field.
 */
export function perplexityDomainFilter(
  includeDomains: readonly string[] = [],
  excludeDomains: readonly string[] = []
): string[] {
  return [...includeDomains, ...excludeDomains.map((d) => `-${d}`)];
}
