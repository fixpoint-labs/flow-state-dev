# Writing a user resource: always through its flow

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · example

> **PROPOSED.** A sketch from the design review, not code. None of the APIs it names exist yet (`defineView`, `defineKit`, `runBy`, `fsd.resource`, `useView`, `ViewOutput`, kit slots and the kits' views). Names follow the working name "kit", which is open hold [O5](../DECISIONS.md#o5). The child that builds each piece owns its real shape.

Reads are direct, by scope and key, with no session; the access check is the resource's own client config, as today. Every client write goes through a flow, the owner's answer to [O3](../DECISIONS.md#o3): `runBy` names it, and the client sends that flow's session an action, found or made by the server. For plain data (pins), `runBy: "default"` names the framework's default write flow, which sets, patches and deletes fields under the resource's schema, owner fence and optional `canWrite`. Where a flow does real work (a dashboard), `runBy` names the app's own. A resource with no `runBy` cannot be written from a client. Built by [FIX-2624](https://linear.app/fixpoint-labs/issue/FIX-2624).

**Plain data: pins, on the default write flow.** No flow to write; a write is one line.

```ts
export const pins = defineResource({
  scope: "user",
  stateSchema: z.object({ pinned: z.array(z.string()).max(50).default([]) }),
  client: { state: { read: true } },
  runBy: "default",                                   // the framework's default write flow, one session per user
  canWrite: ({ next }) => new Set(next.pinned).size === next.pinned.length,   // optional, run inside that flow
});

// Client: an action on the default flow's session. The schema, the owner fence and canWrite run there,
// and the write records a request like any action. The updater runs on the state the helper read and
// the write carries that version; if another write landed first, the flow refuses it with the current
// state (resource-cas) and the helper re-runs the updater on that, so concurrent pins are never lost.
await fsd.resource(pins).update((s) => ({ pinned: toggle(s.pinned, threadId) }));

// toggle(list, id): drop id if present, append it if not. A plain helper, not framework API.

// React: the value and the same setters.
const { value, update } = useResource(pins);
```

**Real work: a dashboard, on its own flow.** The same route and the same send; only the flow differs.

```ts
export const artifacts = defineResourceCollection({
  pattern: "artifacts/*",
  scope: "user",
  stateSchema: artifactState,
  client: { state: { read: true }, content: { read: true } },   // what a client may read, as today
  runBy: { flow: "artifact", session: "per-resource" },         // the app's flow, one session per artifact
});

// Client
const q3 = await fsd.resources.user("artifacts/q3").state();     // direct read, no session
await fsd.resource("artifacts/q3").send("refresh", { data });      // data in; the flow builds the resource
```
