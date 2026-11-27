# Planned surface for the kits release (signatures only)

These pages are written for the release that ships kits. `defineKit` and `slot` exist in
`@flow-state-dev/core` (`packages/core/src/kit/define-kit.ts`), and `createFlowState({ kits })` in
`@flow-state-dev/engine`. The workforce, harnesses and Claude Code kits are planned: write them as
they will ship, from this surface.

```ts
// fsdev.config.ts in an app
import { createFlowState } from "@flow-state-dev/engine";
import { workforce } from "@flow-state-dev/workforce";
import { harnesses } from "@flow-state-dev/harness-manager";
import { claudeCode } from "@flow-state-dev/claude-code";

export default createFlowState({
  kits: [
    workforce({ directory: "./workforce", agent: { model: "openai/gpt-6-luna" } }), // reads WORKER.md files from the folder
    harnesses({ workspace: "./workspace" }),   // coding harnesses; opens the `harnesses` slot
    claudeCode(),                              // fills harnesses' slot
  ],
  // optional: the app's own fill of a slot, and its own flows
  // fill: { [harnesses.slots.harnesses]: [codexHarness(), cursorHarness()] },
  flows: [/* the app's own FlowInstances, an array */],
});
```

- Kits are listed in any order; the engine orders them by what each requires and fills each slot once.
- A kit declares `slots` other kits fill, and `contributes` to slots of kits it `requires`.
  `harnesses` requires `workforce` and contributes a coding worker flow to workforce's
  `workerFlows` slot; `claudeCode()` fills `harnesses.slots.harnesses`.
- A kit can own a folder in the app (`workforce/`); a file in it the kit does not use stops the app
  from starting, naming the file.
- Views and hooks come from a kit's browser entry (`@flow-state-dev/workforce/browser`), components
  from `/react`.
