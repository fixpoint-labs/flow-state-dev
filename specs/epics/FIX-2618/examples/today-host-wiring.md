# Today: the teammates host assembles workforce by hand

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · example

> **TODAY.** Code from the repository, trimmed for reading. It is the wiring the epic removes.

From `labs/teammates/host.mts` (426 lines; the circular callback is line 345). The worker installation needs the flows map before the map exists, so it takes a callback. Two flows exist only to serve a read. The flows are spread together by hand and cast with `as never`. Then `src/adapter.ts` (1,788 lines) reads it all back. Removed by [FIX-2622](https://linear.app/fixpoint-labs/issue/FIX-2622) (proved) and [FIX-2627](https://linear.app/fixpoint-labs/issue/FIX-2627) (built).

```ts
let flows: Record<string, unknown> = {};
const installation = createWorkerInstallation({
  standardWorkers: roster.workers,
  workerFlows: () => flows as never,          // circular: needs the map before it exists
});
flows = {
  [AGENT_FLOW]: { flow: defineAgentWorkerFlow({ installation, uses: [ /* 4 capabilities */ ], … }) },
  [CODER_FLOW]: coderFlow({ harnesses, defaultHarness, workspace, checks, … }),
};
const copies = hireWorkforce(installation) as Array<{ id: string }>;
const readinessFlow = defineFlow({ kind: READINESS_FLOW, actions: { read: … } } as never)(…);  // a flow just to serve a read
const contextFlow   = defineFlow({ kind: LAB_CONTEXT_FLOW, actions: { read: … } } as never)(…);  // and another
createFlowState({
  flows: Object.fromEntries([...copies, readinessFlow, contextFlow].map((c) => [c.id, c])),
  …
} as never);
// …then src/adapter.ts (1,788 lines) reads it all back.
```
