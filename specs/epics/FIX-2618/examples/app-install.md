# An app: one config object per kit, plus the app's own flows

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · example

> **PROPOSED.** A sketch from the design review, not code. None of the APIs it names exist yet (`defineView`, `defineKit`, `runBy`, `fsd.resource`, `useView`, `ViewOutput`, kit slots and the kits' views). Names follow the working name "kit", which is open hold [O5](../DECISIONS.md#o5). The child that builds each piece owns its real shape.

Order, slot contributions, name prefixes and the client manifest are resolved once, at `createFlowState`. App-specific flows still sit beside the kits. `mission` and `livingArtifacts` are illustrative. Built by [FIX-2626](https://linear.app/fixpoint-labs/issue/FIX-2626).

```ts
export default createFlowState({
  kits: [
    workforce({ roster: "./workforce", model: "openai/gpt-6-luna", memory: true }),
    harnesses({ claudeCode: {}, codex: {}, cursor: {}, workspace: ".", checks: ["pnpm test"] }),
    mission({ teamSize: 4 }),
    livingArtifacts({ refreshEvery: "1h" }),
  ],
  flows: { pins: pinsFlow },                     // app-specific pieces still welcome
  stores: { default: { primary: sqliteStores({ filename }) } },
});
// Order, slot contributions, name prefixes and the client manifest are resolved here, once.
```
