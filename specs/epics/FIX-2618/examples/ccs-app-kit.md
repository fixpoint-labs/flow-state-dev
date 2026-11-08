# claude-code-style: the app's own local kit

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · example

> **PROPOSED.** A sketch from the design review, not code. None of the APIs it names exist yet (`defineView`, `defineKit`, `runBy`, `fsd.resource`, `useView`, `ViewOutput`, kit slots and the kits' views). Names follow the working name "kit", which is open hold [O5](../DECISIONS.md#o5). The child that builds each piece owns its real shape.

`labs/claude-code-style/kit.ts`, proposed: everything only this app has. Pins become a user resource with a declared write rule: read directly and written directly, with the schema and owner fence run server-side, so `listPins` and the pins flow both go (open hold [O3](../DECISIONS.md#o3); under `runBy` only, the pins flow stays as a per-user session). The app's settings for workforce's agent and coordinator flows go in through workforce's slots. The test for what stays here: if another app would write the same thing, it belongs in a package kit. Built by [FIX-2628](https://linear.app/fixpoint-labs/issue/FIX-2628).

```ts
export const claudeCodeStyle = defineKit({
  name: "ccs",
  requires: [workforce, harnesses],

  resources: {
    pins: defineResource({
      scope: "user",
      stateSchema: z.object({ pinned: z.array(z.string()).default([]) }),
      client: { state: { read: true, write: { owner: true } } },   // read and written directly; no listPins, no pins flow
    }),
  },

  // Into workforce's slots: the lab's two main workers' flow settings.
  contributes: ({ config }) => ({
    [workforce.slots.agentFlow]: { afterAnswer: sessionTitleGenerator({ model: config.utilityModel }), answerAgain: config.answerAgain },
    [workforce.slots.coordinatorFlow]: { afterAnswer: sessionTitleGenerator({ model: config.utilityModel }) },
  }),
  config: z.object({ utilityModel: z.string(), answerAgain: z.boolean().default(true) }),
});
```
