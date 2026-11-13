# @flow-state-dev/workspace

Project resource collections into a directory an agent works in, and reconcile its edits back.

```bash
pnpm add @flow-state-dev/workspace
```

```ts
import { collectionIdFor, createHostPlace, createProjection, principalFromContext } from "@flow-state-dev/workspace";

const principal = principalFromContext(ctx);

const projection = createProjection({
  place: createHostPlace("/tmp/run-42"),
  mounts: [
    {
      prefix: "artifacts",
      collection: artifacts,
      collectionId: collectionIdFor(artifacts, principal),
      writable: true,
    },
  ],
});

await projection.hydrate();
// the agent runs, editing files under /tmp/run-42
const report = await projection.flush();
```

Reference: [the `workspace` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/workspace).
