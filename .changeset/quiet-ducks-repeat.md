---
"@flow-state-dev/workforce": minor
"@flow-state-dev/fsdev": minor
---

`fsdev gen` now finds the TypeScript in a workforce tree's `resources/` folders and exports it as a fourth map, `resourceModules` (FIX-1388).

**Your committed `workforce.gen.ts` goes stale on upgrade**, whether or not your tree has any `resources/` modules: the file gains the fourth map and a line of its header. `fsdev gen --check` stays red until you run `fsdev gen` and commit the result.

`renderWorkforceCode` takes the discovered modules as a second argument.
