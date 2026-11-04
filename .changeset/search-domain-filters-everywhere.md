---
"@flow-state-dev/tools": patch
---

`search({ includeDomains, excludeDomains })` now filters on Brave and Perplexity Sonar too, where the domains were ignored before. Brave writes them into the query as `site:` / `-site:` operators, as Serper does; Sonar sends them as `search_domain_filter`, as the Perplexity Search API does (FIX-2496).
