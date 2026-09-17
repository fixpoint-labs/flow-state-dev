---
"@flow-state-dev/workforce": minor
"@flow-state-dev/fsdev": minor
---

`fsdev gen` now finds the TypeScript in a workforce tree's `resources/` folders (FIX-1388)

A `resources/` folder took Markdown only: a `.ts` file dropped in beside the documents produced no
document, no error, and no signal of any kind. The command now walks every `resources/` folder the
convention reads — the organisation's, each team's, and each worker's own — and exports a fourth map,
`resourceModules`, keyed by the same ref a document of that name in that folder would get.

A document and a module claiming one ref are refused by name at generation rather than one of them
quietly winning. What a module exports is checked by your own `tsc` against the generated map's
types: `ResourceModuleExport` for the organisation's and a team's folders, and the narrower
`WorkerResourceModuleExport` for a worker's own, which takes a resource and not a capability.

Nothing reads the new map yet — installing what it holds is the next change.

**Your committed `workforce.gen.ts` goes stale on upgrade**, whether or not your tree has any
`resources/` modules: the file gains the fourth map and a line of its header. `fsdev gen --check`
is red until you run `fsdev gen` and commit the result.

`renderWorkforceCode` takes the discovered modules as a second argument. `discoverWorkforceCode`
returns them on `resourceModules`, and `mintResourceRef` is now exported from
`@flow-state-dev/workforce/loader` as the one rule that names a resource, whichever door read it.
