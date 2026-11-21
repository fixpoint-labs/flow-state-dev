---
"@flow-state-dev/patterns": minor
---

Add an installable `research()` kit that plans multi-step web research, uses search/fetch/crawl tools, retries isolated task failures, and returns a provenance-checked cited report with its typed task results (FIX-2822).

Retrieval provenance and attempt counts reset for each run. Set `maxAttemptsPerTask: 1` or `maxTotalRetries: 0` to disable task retries.
