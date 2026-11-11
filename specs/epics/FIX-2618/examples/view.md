# A view: a read with a scope, recorded dependencies and keyed rows

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · example

> **PROPOSED.** A sketch from the design review, not code. None of the APIs it names exist yet (`defineView`, `defineKit`, `runBy`, `fsd.resource`, `useView`, `ViewOutput`, kit slots and the kit packages' views). The name "kit" is the owner's answer to [O5](../DECISIONS.md#o5). The child that builds each piece owns its real shape.

The same rule as a flow read today (a block with input, storing nothing, refusing writes), plus `scope` (no session at user or org) and `key` (a notice can name the rows that changed). Nothing is declared about dependencies: the engine records what each run read and tells the view's watchers when one of those changes ([O2](../DECISIONS.md#o2), amended by FIX-2623 D1). A model call inside a view is refused. It installs on its own or in a kit. Built by [FIX-2623](https://linear.app/fixpoint-labs/issue/FIX-2623); the recorder's method is [FIX-2621](https://linear.app/fixpoint-labs/issue/FIX-2621)'s result.

```ts
export const missionBoard = defineView({
  name: "missionBoard",
  scope: "user",                                 // no session needed
  input: z.object({ missionId: z.string() }),
  key: (row) => row.objectiveId,                   // notices carry the keys that changed
  block: handler({
    name: "mission-board",
    execute: async ({ missionId }, ctx) => {
      const objs = await ctx.resources.objectives.findBy({ missionId });   // recorded: a change re-runs the view
      return Promise.all(objs.map((o) => progressOf(ctx, o)));          // joins on the server
    },
  }),
});

// Standalone, outside a kit:
defineFlow({ kind: "desk", views: { missionBoard } });
```
