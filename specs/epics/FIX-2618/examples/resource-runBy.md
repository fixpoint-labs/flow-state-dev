# Writing a user resource: a write rule, or the flow that runs it

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · example

> **PROPOSED.** A sketch from the design review, not code. None of the APIs it names exist yet (`defineView`, `defineKit`, `runBy`, `fsd.resource`, `useView`, `ViewOutput`, kit slots and the kits' views). Names follow the working name "kit", which is open hold [O5](../DECISIONS.md#o5). The child that builds each piece owns its real shape.

Reads are direct, by scope and key, with no session; the access check is the resource's own client config, as today. Writes take one of two paths, the open hold [O3](../DECISIONS.md#o3): plain CRUD (pins) under a declared write rule the server enforces, or, where a flow does real work (a dashboard), an action sent to the resource's own session, found or made by the server. A resource with neither cannot be written from a client. Built by [FIX-2624](https://linear.app/fixpoint-labs/issue/FIX-2624).

**Path 2, `runBy`: a dashboard, where the refresh is a flow's work.**

```ts
export const artifacts = defineResourceCollection({
  pattern: "artifacts/*",
  scope: "user",
  stateSchema: artifactState,
  client: { state: { read: true }, content: { read: true } },   // what a client may read, as today
  runBy: { flow: "artifact", session: "per-resource" },        // one session per artifact
});

// Client
const q3 = await fsd.resources.user("artifacts/q3").state();   // direct read, no session
await fsd.resource("artifacts/q3").send("refresh", {});         // to its own session, found or made
```

**Path 1, a write rule: pins, plain CRUD with no flow.**

```ts
export const pins = defineResource({
  scope: "user",
  stateSchema: z.object({ pinned: z.array(z.string()).max(50).default([]) }),
  client: {
    state: {
      read: true,
      write: {                                       // run server-side on every client write
        owner: true,                                 // only the user the resource belongs to
        canWrite: ({ next }) => new Set(next.pinned).size === next.pinned.length,  // optional hook
      },
    },
  },
});

// Client: the schema, the owner fence and canWrite run before the write lands.
await fsd.resources.user("pins").state.update((s) => ({ pinned: [...s.pinned, threadId] }));
```
