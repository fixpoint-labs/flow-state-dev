---
"@flow-state-dev/react": minor
---

`Roster` lists the seats hired in an organization, including the ones a boot reload could not restore, and `BoardColumns` draws one task board as columns grouped by the existing task statuses. Both read a collection through the host's own resource client, take no organization filter because the collections are organization-scoped on the server, and theme through `--fsd-panel-*` custom properties (FIX-1477).
