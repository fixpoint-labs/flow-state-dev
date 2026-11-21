---
"@flow-state-dev/workforce": minor
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/shift-manager": patch
---

The Error Reporter keeps a history of what it saw and what it did, and workers can read it with the general resource tools (FIX-2793).

- **workforce:** every occurrence the reporter takes in (past a report's five kept occurrences, and a held request by its task) and every status change of a report (with the issue's identifier and link once filed) is written to an hourly history in the reporter's own `error-reports` collection, at most 250 entries an hour (the rest counted as cut), kept 90 days. A new read-only collection, `defineErrorHistoryCollection({ reporter })` (resource name `ERROR_HISTORY_RESOURCE`), shows it as one record per report a day at `error-history/<YYYY-MM-DD>/<ref>`: its title, status in words, counts, task ids, issue and entries. It is `llmReadable`, so `searchResources` (narrow by day with the prefix `error-history/<YYYY-MM-DD>`) and `readResourceContent` reach it. The operator reads every report; a user reads only reports of their own failures, and other reports read as unknown. `ErrorReporter` gains `readHistory(days)`.
- **core / engine:** `readResourceContent` reads a record of a projected collection that opted in with `llmReadable`, by the uri `searchResources` returned; a projected ref carries the collection's `config.llmReadable`.
- **shift-manager:** the DevTeam's Shift Coordinator and error-reporter answer "what was reported, and was it filed?" by searching and reading the error history themselves.

Docs: packages/workforce/README.md (Error Reporter: the history and `defineErrorHistoryCollection`), packages/core/README.md (`readResourceContent` over projected collections), packages/shift-manager/README.md (asking what was reported)
