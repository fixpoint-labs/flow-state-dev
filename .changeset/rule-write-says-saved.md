---
"@flow-state-dev/workforce": patch
---

The standing-rule write tools (`rules/add`, `rules/change`, `rules/remove`) now return `saved: true` when the write landed and `saved: false` (with `refused`) when it didn't. Every refusal reason now starts `Not saved:`. The tool descriptions tell the worker to say a rule is saved only on `saved: true`. Before this, a refused write still returned the list, and a worker could read that as success and tell the user the rule was saved.
