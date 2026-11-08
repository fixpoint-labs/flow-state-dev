# A kit on top of workforce: everything about one feature in one place

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · example

> **PROPOSED.** A sketch from the design review, not code. None of the APIs it names exist yet (`defineView`, `defineKit`, `runBy`, `fsd.resource`, `useView`, `ViewOutput`, kit slots and the kits' views). Names follow the working name "kit", which is open hold [O5](../DECISIONS.md#o5). The child that builds each piece owns its real shape.

An illustrative feature (missions and their objectives) that requires workforce and reaches into it only through the slots workforce publishes (`workerFlows`, `coordinatorTools`, `boardFields`). Mission is an example, not a child of this epic. Built by [FIX-2626](https://linear.app/fixpoint-labs/issue/FIX-2626) (the unit) and [FIX-2627](https://linear.app/fixpoint-labs/issue/FIX-2627) (the first slots).

```ts
export const mission = defineKit({
  name: "mission",
  requires: [workforce],
  config: z.object({ planner: z.string().default("planner"), teamSize: z.number().default(3) }),

  resources: { missions, objectives },             // user-scoped collections, runBy their flows
  flows: { mission: missionFlow, objective: objectiveFlow },
  views: { missionBoard, objectiveProgress },

  // Reach into workforce only through the slots it publishes.
  contributes: ({ config }) => ({
    [workforce.slots.workerFlows]: { [config.planner]: plannerWorkerFlow(config) },
    [workforce.slots.coordinatorTools]: [hireTeamForObjective(config)],
    [workforce.slots.boardFields]: [objectiveOfTask],
  }),

  client: missionClient,                            // typed calls + hooks; no app adapter
});
```
