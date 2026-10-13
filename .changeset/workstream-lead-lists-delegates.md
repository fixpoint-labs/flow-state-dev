---
"@flow-state-dev/workforce": minor
---

A workstream's lead must list delegates: `openWorkstream` refuses a lead whose `delegates:` is empty with `cannot-lead`. `defineWorkstreamBlocks` also returns `listLeadsTool` (`listLeads`), which lists the workers on the caller's roster that can lead, so a project coordinator given it and `openWorkstream` can open a workstream for the person and hand their ask to it in the same turn. `installation.roster(ctx)` reads the user's whole roster, and `RosterWorker` carries its `delegates` (FIX-1793).
