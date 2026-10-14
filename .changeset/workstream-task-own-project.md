---
"@flow-state-dev/workforce": patch
---

A task filed from a workstream or a project's conversation now names that conversation's project in `input.project`, whatever project the filer named (FIX-1969). Before, a lead that guessed a wrong project id got every coding run refused `other-project`.
