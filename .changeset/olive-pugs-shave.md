---
"@flow-state-dev/workforce": patch
---

Read a worker's own `resources/` folder as a third document root (FIX-1368).

`readResourcesDirectory` now walks `workers/<name>/resources/` under both `org/` and every team,
alongside the org and team roots it already read. A document there is addressed by the folders above
it — `teams/<teamId>/workers/<worker>/<name>`, or `workers/<worker>/<name>` for an organization-level
worker — so two seats can each have a `runbook` without their authors agreeing on a name.

The org and team roots are unchanged: same documents, same order, same errors. A worker folder's
documents load whether or not the folder holds a `WORKER.md`, and a `workers/` level or worker folder
that is symlinked or unreadable is reported under its own path with the existing `unreadable-slot`
kind. No new error kind.

A worker's folder is a namespace, not a visibility boundary. To give one seat a document of its own,
put `flowIsolation: true` in that document's frontmatter: each seat then gets its own rows, and a
sibling seat asking for the same document reads its own empty copy.
