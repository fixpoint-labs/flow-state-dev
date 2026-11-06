---
"@flow-state-dev/react": minor
---

The workforce panels move to a new subpath, `@flow-state-dev/react/workforce`, so a chat app's view of the root no longer lists them (FIX-2456). Import `Roster`, `BoardColumns`, `BoardList`, `WorkerDetail`, `groupIntoColumns`, `BOARD_STATUS_COLUMNS` and their types (`RosterProps`, `BoardCardRow`, `PanelRowSource` and the rest) from there. **Breaking:** the old root names are removed, with no deprecated aliases; change `from "@flow-state-dev/react"` to `from "@flow-state-dev/react/workforce"` for these names. `rosterPropNames`, `boardColumnsPropNames` and `boardListPropNames` are removed from the public API with no new home.

Docs: packages/react/README.md (the panels section and its `Roster`, `BoardColumns`, `BoardList` and `WorkerDetail` snippets import from `@flow-state-dev/react/workforce`; the panels moved there and the old root names are removed), apps/docs/docs/workforce/ui.md (every panel import from `@flow-state-dev/react/workforce`; the old root names are removed), apps/docs/docs/api/react.md (the panels paragraph: `Roster`, `BoardColumns`, `BoardList` and `WorkerDetail` moved to `@flow-state-dev/react/workforce` and are no longer on the root; `FlowNavigator` stays on the root), apps/docs/guides/writing-ui-stories.md (the `Roster` story import from `@flow-state-dev/react/workforce`)
