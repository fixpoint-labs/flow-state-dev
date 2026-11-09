---
"@flow-state-dev/workforce": minor
---

You can rename your own workers, and edit a standard worker for yourself (FIX-2526).

- **Names:** `hire` and `edit` take `name`, a display name kept apart from the id. The id stays the worker's address for messages, tasks and sessions, so a rename moves nothing. A blank name, or `edit` with `name: null`, clears it. Rows stored before this release read as having no name. The roster, the identity line and the client's `roster()` show the name.
- **Editing a standard worker:** `edit` on a standard worker's id no longer refuses. The first edit copies the worker from its `WORKER.md` onto the caller's own roster under the same id, then applies the change. From the next turn, that user's turns read their copy; every other user still gets the file's. The copy is a snapshot: a later change to the file doesn't reach a user who has a copy until they reset. `hire` and `fork` onto a standard id are still refused, and a flow kept for standard workers (`standardOnly`) still refuses an edit.
- **`reset(id)`:** a new roster action, and `WorkforceClient.reset`, that deletes the caller's copy of a standard worker, so their next turn reads the file again.
- **`RosterEntry.edited`:** `true` on a standard worker the caller has their own copy of. Both rosters list such a worker once, as `standard: true`. `RosterEntry.name` is now the row's own name for any worker, else the file's.

Docs: packages/workforce/README.md (`hire`/`edit` take `name`; `edit` on a standard worker makes your copy under its id; `reset`; `RosterEntry.edited`; drop the line that standard workers can't be edited), apps/docs pages on hiring and editing workers (same).
