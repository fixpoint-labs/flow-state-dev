# A view: a read with a scope, declared dependencies and keyed rows

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · example

> **PROPOSED.** A sketch from the design review, not code. None of the APIs it names exist yet (`defineView`, `defineKit`, `runBy`, `fsd.resource`, `useView`, `ViewOutput`, kit slots and the kits' views). Names follow the working name "kit", which is open hold [O5](../DECISIONS.md#o5). The child that builds each piece owns its real shape.

The same rule as a flow read today (a block with input, storing nothing, refusing writes), plus `scope` (no session at user or org), `dependsOn` (the server tells the view's watchers when one changes) and `key` (a notice can name the rows that changed). It installs on its own or in a kit. Built by [FIX-2623](https://linear.app/fixpoint-labs/issue/FIX-2623); the dependency check's method is [FIX-2621](https://linear.app/fixpoint-labs/issue/FIX-2621)'s result.

```ts
export const missionBoard = defineView({
  name: "missionBoard",
  scope: "user",                                 // no session needed
  input: z.object({ missionId: z.string() }),
  dependsOn: [objectives, workstreams, taskBoard("tasks")],  // the server notices on the view itself
  key: (row) => row.objectiveId,                   // notices carry the keys that changed
  block: handler({
    name: "mission-board",
    execute: async ({ missionId }, ctx) => {
      const objs = await ctx.resources.objectives.findBy({ missionId });   // filter at the source
      return Promise.all(objs.map((o) => progressOf(ctx, o)));          // joins on the server
    },
  }),
});

// Standalone, outside a kit:
defineFlow({ kind: "desk", views: { missionBoard } });
```
