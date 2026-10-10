---
"@flow-state-dev/workforce": minor
---

A `best-fit` coordinator with a `description:` is now one of its own choices, so a post the evaluator picks it for runs the coordinator's own turn; a new `minConfidence:` key (0 to 1, `best-fit` only) sends a delegate pick below it, or one with no reported confidence, to the fallback or the coordinator's turn; the routing record's new `fit` field says why best fit handed a post on; and the coordinator's own turn now reads each delegate's answer under that delegate's name, with each post its routing handed on marked as handled (FIX-1833).
