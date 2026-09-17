---
"@flow-state-dev/workforce": minor
---

`splitResourceModules` turns the generated `resourceModules` map into the two things a flow already takes (FIX-1388).

```ts
const { capabilities, resources } = splitResourceModules(resourceModules);

const agent = defineAgentWorkerFlow({ uses: capabilities, /* ... */ });
const flowResources = { ...resourcesFromDocs(documents), ...resources };
```

A capability goes to the worker kind's `uses`, where the resources it declares for itself reach the flow; a plain resource or collection merges into the one resource map, under its own ref. Nothing is installed for you — spread both at your own call site. An entry that can be neither is refused, naming its ref.
