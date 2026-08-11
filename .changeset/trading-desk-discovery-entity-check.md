---
"@flow-state-dev/trading-desk": patch
---

Validate discovery search results against the company being analysed before they reach an analyst prompt (FIX-779). Web search for a thinly covered or ambiguous ticker sometimes returns pages about a different company, and those snippets were passed into Phase 1 analyst prompts as context with nothing checking whose they were.

The subject's business identity is now resolved once, before the analyst bench fans out, and the six entity-scoped `discover_*_context` tools drop results that name neither the ticker nor the company. A dropped result leaves a URL and a reason in a new `excluded` list — its title and snippet are discarded, so the wrong company's prose never reaches the model. Every discovery payload carries an `entityCheck` verdict (`verified` / `unchecked` / `not-applicable`) that the analyst prompt reads before treating any item as evidence.

Short company names are checked too. An issuer whose name carries no long word — `3M Company`, `XP Inc.` — is identified by its ticker, its own website, and its short name (`3M`), rather than being treated as unidentifiable and skipped. Short names are matched case-sensitively, so `3M` in a headline counts and `3m` in running prose does not.

Matching a company name is stricter than matching any of its words. Words that double as routine financial prose (`american`, `financial`, `target`, `energy`) never verify a result on their own, and two of them only verify when they appear side by side: "American Financial posted a record quarter" names American Financial Group, while "American consumers face financial pressure as rates rise" is macro prose about no issuer at all and is now excluded. Distinctive words, including category nouns like `semiconductor`, still verify on their own.

A search that could not run is never reported as a search that found nothing. When no search provider is configured, or every provider fails, the result is tagged `unchecked` rather than `verified` — so an outage reads as missing coverage, not as a completed check that came back clean.

First-party matching also survives an ordinary corporate site published at a locale or section root (`company.com/en/`). Only a product page on a shared host — a fund's page on its sponsor's domain — gives up the first-party shortcut, since a sibling fund's page is not evidence about this one.

Macro and market-context discovery are deliberately exempt: those queries ask about the environment around a name, so a good result often never names it. They are tagged `not-applicable` and pass through unfiltered. When the company's identity cannot be resolved at all, the payload is tagged `unchecked` and nothing is dropped — losing every snippet because the company could not be identified would be worse than the contamination being guarded against.
