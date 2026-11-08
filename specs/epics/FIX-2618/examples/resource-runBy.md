# A resource that names the flow that runs it

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · example

> **PROPOSED.** A sketch from the design review, not code. None of the APIs it names exist yet (`defineView`, `defineKit`, `runBy`, `fsd.resource`, `useView`, `ViewOutput`, kit slots and the kits' views). Names follow the working name "kit", which is open hold [O5](../DECISIONS.md#o5). The child that builds each piece owns its real shape.

Reads are direct, by scope and key, with no session; the access check is the resource's own client config, as today. Writes go to the resource's own session, found or made by the server, one per resource (a dashboard) or one per user (pins). A resource with no `runBy` cannot be written from a client. Built by [FIX-2624](https://linear.app/fixpoint-labs/issue/FIX-2624).

```ts
export const artifacts = defineResourceCollection({
  pattern: "artifacts/*",
  scope: "user",
  stateSchema: artifactState,
  client: { state: { read: true }, content: { read: true } },   // what a client may read, as today
  runBy: { flow: "artifact", session: "per-resource" },        // "per-user" for pins
});

// Client
const q3 = await fsd.resources.user("artifacts/q3").state();   // direct read, no session
await fsd.resource("artifacts/q3").send("refresh", {});         // to its own session, found or made
```
