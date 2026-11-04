---
"@flow-state-dev/tools": patch
---

`search({ includeDomains, excludeDomains })` now filters on Brave and Perplexity Sonar too, where the domains were ignored before. Brave writes them into the query as `site:` / `-site:` operators, as Serper does; Sonar sends them as `search_domain_filter`, as the Perplexity Search API does. Perplexity's filter takes an include list or an exclude list, not both, so on Perplexity and Sonar a search that sets both now sends the include list alone, where before it sent both and the request was not valid (FIX-2496).
