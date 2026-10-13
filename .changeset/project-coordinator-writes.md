---
"@flow-state-dev/workforce": minor
---

`defineProjectBlocks()` adds `setBrief`, which sets, changes or clears a project's brief, members only. `setBrief` and `setRepository` take an optional `project`: left out, they change the project the calling conversation belongs to, and a conversation that belongs to a project is refused (`other-project`) when it names another. A project coordinator can now hold both and manage its own project. `linkedProjectOf` is exported (FIX-1900).
