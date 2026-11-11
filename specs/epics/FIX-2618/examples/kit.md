# A kit on top of workforce: everything about one feature in one place

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · example

> **PROPOSED.** A sketch from the design review, not code. None of the APIs it names exist yet (`defineView`, `defineKit`, `runBy`, `fsd.resource`, `useView`, `ViewOutput`, kit slots and the kit packages' views). The name "kit" is the owner's answer to [O5](../DECISIONS.md#o5). The child that builds each piece owns its real shape.

An illustrative feature (missions and their objectives) that requires workforce and reaches into it only through the slots workforce publishes (`workerFlows`, `coordinatorTools`, `boardFields`). Mission is an example, not a child of this epic.

**Two halves** ([O1](../DECISIONS.md#o1), decided by the owner). The library half is the kit's package, imported and versioned: its views, blocks, capabilities, hooks and components, from its browser entry and `/react`. `defineKit` itself only installs and composes: no `resources`, `views` or `client` field, since resources and views live on the flows its install returns ([FIX-2626 D1](../../../issues/FIX-2626/DECISIONS.md#d1)). The copied half is a directory the kit owns in the app (here `mission/`): its `init` scaffolds starter files there, Shadcn-style, the app-level flows a user configures among them (`mission.flow.ts`, `objective.flow.ts`), and from then on the app owns them. At install the kit's loader reads the directory through the shared walker, consuming every file or refusing it, and any refusal stops the app starting ([FIX-2626 D2](../../../issues/FIX-2626/DECISIONS.md#d2)). The kit never also exports those flows. Built by [FIX-2626](https://linear.app/fixpoint-labs/issue/FIX-2626) (the unit) and [FIX-2627](https://linear.app/fixpoint-labs/issue/FIX-2627) (the first slots).

```ts
export const mission = defineKit({
  name: "mission",
  requires: [workforce],
  config: z.object({ planner: z.string().default("planner"), teamSize: z.number().default(3) }),

  directory: { path: "mission", load: loadMissionDir },  // the copied half: scaffolded by init, owned by the app, read at install

  // Reach into workforce only through the slots it publishes.
  contributes: ({ config }) => ({
    [workforce.slots.workerFlows]: { [config.planner]: plannerWorkerFlow(config) },
    [workforce.slots.coordinatorTools]: [hireTeamForObjective(config)],
    [workforce.slots.boardFields]: [objectiveOfTask],
  }),

  // Its flows carry the missions and objectives resources and the board views; screens import those from the package.
  install: ({ config, folder }) => ({ flows: [...folder.flows, missionBoardFlow(config)] }),
});
```
