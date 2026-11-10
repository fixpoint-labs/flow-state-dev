# claude-code-style: the host, about 40 lines

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · example

> **PROPOSED.** A sketch from the design review, not code. None of the APIs it names exist yet (`defineView`, `defineKit`, `runBy`, `fsd.resource`, `useView`, `ViewOutput`, kit slots and the kits' views). The name "kit" is the owner's answer to [O5](../DECISIONS.md#o5). The child that builds each piece owns its real shape.

`host.mts` is 158 lines today. Env parsing stays in `fsdev.config.mts`, as now. Workforce's config replaces the projects flow; the harness kit's `coding` config replaces `harness-thread.mts` (346 lines). Gone: the circular `workerFlows` callback, `hireWorkforce`, the flows map, three `defineFlow` calls and every `as never`. **The line counts are estimates from reading the code;** [FIX-2628](https://linear.app/fixpoint-labs/issue/FIX-2628) measures them.

```ts
export function openLab(o: LabOptions) {
  return createFlowState({
    kits: [
      workforce({
        workers: "./workforce",                         // the WORKER.md tree, read by the kit
        model: o.model,
        projects: { checkRepository: o.checkRepository },  // replaces the projects flow
      }),
      harnesses({
        claudeCode: { modes: ["default", "plan"] }, codex: {}, cursor: {},
        workspace: { root: join(o.data, "runs"), repositories: o.repositories, setup: o.setup },
        coding: { review: "per-worker", awaitPullRequests: true, checks: "project" },  // replaces harness-thread.mts
        ...(o.scriptedStepMs ? { scripted: { stepMs: o.scriptedStepMs } } : {}),
      }),
      claudeCodeStyle({ utilityModel: o.utilityModel, answerAgain: o.answerAgain }),
      ...(o.goalFlows ? [await import(o.goalFlows).then((m) => m.default)] : []),
    ],
    stores: { default: { primary: sqliteStores({ filename: join(o.data, "lab.sqlite") }) } },
    durable: true,
    models: { default: o.model, intents: { utility: [o.utilityModel] } },
  });
}
// Gone: the circular workerFlows callback, hireWorkforce, the flows map, three defineFlow calls, every `as never`.
```
