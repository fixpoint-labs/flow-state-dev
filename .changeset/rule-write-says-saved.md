---
"@flow-state-dev/workforce": patch
---

The standing-rule write tools (`rules/add`, `rules/change`, `rules/remove`) return `saved: true` when the write landed and `saved: false` with `refused` when it did not. Every refusal reason starts `Not saved:`. Say a rule was saved only when `saved` is true (FIX-2798).

Docs: apps/docs/docs/workforce/standing-rules.md
