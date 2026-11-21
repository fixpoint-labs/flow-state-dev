---
"@flow-state-dev/patterns": patch
---

FIX-2819: Add the `secondOpinion` kit at `@flow-state-dev/patterns/kit` and `@flow-state-dev/patterns/second-opinion`. Draft and review work stay private until the audit passes and the answer is synthesized. Audit findings or failed analyzers withhold the answer; recovered critic or judge failures emit a client-visible `second-opinion-unreviewed` marker.
