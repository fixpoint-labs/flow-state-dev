---
"@flow-state-dev/trading-desk": patch
---

Validate discovery search results against the company being analysed before they reach an analyst prompt. Web search for a thinly covered or ambiguous ticker sometimes returns pages about a different company, and those snippets were passed into Phase 1 analyst prompts as context with nothing checking whose they were.

The subject's business identity is now resolved once, before the analyst bench fans out, and the six entity-scoped `discover_*_context` tools drop results that name neither the ticker nor the company. A dropped result leaves a URL and a reason in a new `excluded` list — its title and snippet are discarded, so the wrong company's prose never reaches the model. Every discovery payload carries an `entityCheck` verdict (`verified` / `unchecked` / `not-applicable`) that the analyst prompt reads before treating any item as evidence.

Macro and market-context discovery are deliberately exempt: those queries ask about the environment around a name, so a good result often never names it. They are tagged `not-applicable` and pass through unfiltered. When the company's identity cannot be resolved at all, the payload is tagged `unchecked` and nothing is dropped — losing every snippet because the company could not be identified would be worse than the contamination being guarded against.
