---
"@flow-state-dev/harness-manager": minor
---

The coding board view's row gives each task its title and the state the user sees it in, so a screen reads them from the row and computes neither (FIX-2766).

- **`title`** is now always a string: the task's title, else its goal, else its id. It was optional, absent when the task was filed with no title. A screen that wrote `task.title ?? task.goal` can read `task.title`.
- **`state`** is new: orchestration's `TaskView` state of the row (`queued`, `held`, `running`, `waiting`, `failed`, `done` or `cancelled`), worked out with the row's `asks`, so a task with an open ask for the user reads `waiting`. A screen that called `taskView(row, row.asks).state` can read `task.state`.

Both come from one `taskView` of the row, so they follow orchestration's rules exactly.

Docs: no page documents the coding board view's row today; when one does, it lists `title` as always set and the new `state`.
