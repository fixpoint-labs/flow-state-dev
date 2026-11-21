---
"@flow-state-dev/harness-manager": minor
---

A coding run's report now comes under fixed Markdown headings, and a browser card can read it back as parts (FIX-2870).

- `codingBrief` asks every run to end its last message with `## What changed`, `## Checks` (one bullet per check, each led by `passed:`, `failed:`, `pre-existing:` or `not done:`) and `## Worth knowing` (follow-ups, debts, oddities). The report is still Markdown a person reads whole, so an app that shows the answer as it is loses nothing.
- `runReport(answer)`, from the package root and `@flow-state-dev/harness-manager/browser`, reads those sections back: `{ changed, checks: [{ status, text }], notes }`, or `null` for an answer with none of the headings. `RUN_REPORT_HEADINGS` names the three headings.

Docs: packages/harness-manager/README.md (the coding brief's report, and `runReport` beside `reviewDetail`)
