---
"@flow-state-dev/workforce": minor
---

`splitResourceModules` turns the generated `resourceModules` map into something a worker kind can use (FIX-1388)

`fsdev gen` finds the TypeScript in a workforce tree's `resources/` folders and exports it as
`resourceModules`. Until now nothing read that map. `splitResourceModules` separates it into the two
things an app already passes — the capabilities a worker kind installs through `uses`, and the
resources that merge into the flow's one resource map, beside what the Markdown documents filled:

```ts
const { capabilities, resources } = splitResourceModules(resourceModules);

const agent = defineAgentWorkerFlow({ uses: capabilities, /* ... */ });
const flowResources = { ...resourcesFromDocs(documents), ...resources };
```

A capability's own declared resources reach the flow through `uses`, the same as one you wrote by
hand. Nothing is installed for you: the two maps are spread at your own call site, so what a flow
carries stays readable in your source.

An entry that cannot be either half — a module whose default export went missing, or a hand-written
map holding a bare value — is refused by name rather than filed into the resource map. What a module
exports is still your own `tsc`'s to check against the generated map's types; this is the second
door, for a map that was hand-written or has drifted from the tree, and it refuses what cannot be
either half rather than re-judging which half a thing belongs in.

A seat cannot yet pick which of an installed capability's presets it wants; that is the next change.
