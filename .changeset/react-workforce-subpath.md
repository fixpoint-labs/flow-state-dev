---
"@flow-state-dev/react": minor
---

The workforce panels move to a new subpath, `@flow-state-dev/react/workforce`, so a chat app's view of the root no longer lists them (FIX-2456). Import `Roster`, `BoardColumns`, `BoardList`, `WorkerDetail`, `groupIntoColumns`, `BOARD_STATUS_COLUMNS` and their types (`RosterProps`, `BoardCardRow`, `PanelRowSource` and the rest) from there. The old root names still work as `@deprecated` aliases of the same values until a later minor removes them. `rosterPropNames`, `boardColumnsPropNames` and `boardListPropNames` get no new home: they are deprecated on the root and leave the public API in that same minor.

Docs: packages/react/README.md (the panels section and its `Roster`, `BoardColumns`, `BoardList` and `WorkerDetail` snippets import from `@flow-state-dev/react/workforce`; the old root names as deprecated aliases), apps/docs/docs/workforce/ui.md (every panel import from `@flow-state-dev/react/workforce`), apps/docs/docs/api/react.md (the panels paragraph: `Roster`, `BoardColumns`, `BoardList` and `WorkerDetail` come from `@flow-state-dev/react/workforce`, `FlowNavigator` stays on the root), apps/docs/guides/writing-ui-stories.md (the `Roster` story import from `@flow-state-dev/react/workforce`)
