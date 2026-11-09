# A kit on top of workforce: everything about one feature in one place

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · example

> **PROPOSED.** A sketch from the design review, not code. None of the APIs it names exist yet (`defineView`, `defineKit`, `runBy`, `fsd.resource`, `useView`, `ViewOutput`, kit slots and the kits' views). Names follow the working name "kit", which is open hold [O5](../DECISIONS.md#o5). The child that builds each piece owns its real shape.

An illustrative feature (missions and their objectives) that requires workforce and reaches into it only through the slots workforce publishes (`workerFlows`, `coordinatorTools`, `boardFields`). Mission is an example, not a child of this epic.

**Two halves** ([O1](../DECISIONS.md#o1), pending the owner's confirmation). What `defineKit` exports is the library half, imported and versioned: resources, views, blocks, capabilities and the client hooks. The app-level flows a user installs and configures (here `missionFlow` and `objectiveFlow`) are the copied half: copied into the project by the same registry-style copy-in the UI uses, then owned there. The kit references them by name and never also exports them. If the owner keeps flows as library imports instead, `flows` below ships them like everything else. Built by [FIX-2626](https://linear.app/fixpoint-labs/issue/FIX-2626) (the unit) and [FIX-2627](https://linear.app/fixpoint-labs/issue/FIX-2627) (the first slots).

```ts
export const mission = defineKit({
  name: "mission",
  requires: [workforce],
  config: z.object({ planner: z.string().default("planner"), teamSize: z.number().default(3) }),

  resources: { missions, objectives },             // user-scoped collections, runBy their flows
  flows: copied({ mission: "mission.flow.ts", objective: "objective.flow.ts" }),  // the copied half: installed into the project, not imported
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
