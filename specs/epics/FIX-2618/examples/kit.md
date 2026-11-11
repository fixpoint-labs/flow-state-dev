# A kit on top of workforce: everything about one feature in one place

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · example

> **PROPOSED.** A sketch from the design review, not code. None of the APIs it names exist yet (`defineView`, `defineKit`, `runBy`, `fsd.resource`, `useView`, `ViewOutput`, kit slots and the kits' views). The name "kit" is the owner's answer to [O5](../DECISIONS.md#o5). The child that builds each piece owns its real shape.

An illustrative feature (missions and their objectives) that requires workforce and reaches into it only through the slots workforce publishes (`workerFlows`, `coordinatorTools`, `boardFields`). Mission is an example, not a child of this epic.

**Two halves** ([O1](../DECISIONS.md#o1), decided by the owner). What `defineKit` exports is the library half, imported and versioned: resources, views, blocks, capabilities and the client hooks. The copied half is a directory the kit owns in the app (here `mission/`): its `init` scaffolds starter files there, Shadcn-style, the app-level flows a user configures among them (`mission.flow.ts`, `objective.flow.ts`), and from then on the app owns them. At install the kit's loader reads the directory through the shared walker, consuming every file or refusing it loudly. The kit never also exports those flows. Built by [FIX-2626](https://linear.app/fixpoint-labs/issue/FIX-2626) (the unit) and [FIX-2627](https://linear.app/fixpoint-labs/issue/FIX-2627) (the first slots).

```ts
export const mission = defineKit({
  name: "mission",
  requires: [workforce],
  config: z.object({ planner: z.string().default("planner"), teamSize: z.number().default(3) }),

  resources: { missions, objectives },             // user-scoped collections, runBy their flows; kit-level field pending FIX-2626 D1
  directory: { path: "mission", load: loadMissionDir },  // the copied half: scaffolded by init, owned by the app, read at install
  views: { missionBoard, objectiveProgress },      // kit-level field pending FIX-2626 D1

  // Reach into workforce only through the slots it publishes.
  contributes: ({ config }) => ({
    [workforce.slots.workerFlows]: { [config.planner]: plannerWorkerFlow(config) },
    [workforce.slots.coordinatorTools]: [hireTeamForObjective(config)],
    [workforce.slots.boardFields]: [objectiveOfTask],
  }),

  client: missionClient,                            // typed calls + hooks; pending FIX-2626 D1, which may make this plain package exports
});
```
