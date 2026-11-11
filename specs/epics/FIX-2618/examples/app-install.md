# An app: one config object per kit, plus the app's own flows

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · example

> **PROPOSED.** A sketch from the design review, not code. None of the APIs it names exist yet (`defineView`, `defineKit`, `runBy`, `fsd.resource`, `useView`, `ViewOutput`, kit slots and the kit packages' views). The name "kit" is the owner's answer to [O5](../DECISIONS.md#o5). The child that builds each piece owns its real shape.

Order and slot contributions are resolved once, at `createFlowState`; no client manifest is sent ([FIX-2626 D1](../../../issues/FIX-2626/DECISIONS.md#d1)). App-specific flows still sit beside the kits. `mission` and `livingArtifacts` are illustrative. Built by [FIX-2626](https://linear.app/fixpoint-labs/issue/FIX-2626).

```ts
export default createFlowState({
  kits: [
    workforce({ roster: "./workforce", model: "openai/gpt-6-luna", memory: true }),
    harnesses({ claudeCode: {}, codex: {}, cursor: {}, workspace: ".", checks: ["pnpm test"] }),
    mission({ teamSize: 4 }),
    livingArtifacts({ refreshEvery: "1h" }),
  ],
  flows: [deskFlow, triageFlow],                 // an array: the app's own flows; the keyed record is gone
  stores: { default: { primary: sqliteStores({ filename }) } },
});
// Order and slot contributions are resolved here, once. Screens import from each kit's package.
```
