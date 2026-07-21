---
"@flow-state-dev/orchestration": minor
---

Fork skills now behave like a real fork in the road. A fork child inherits the conversation history up to the fork point (via the generator `history` slot reading `ctx.session.items.history()`), does its bounded work in isolation (`itemVisibility: { client: true, history: false }`), and returns only its result — so the parent generator's context window stays small.

Fork is now delivered as a per-generator tool installed by `createSkillsLibrary`'s new `fork` preset — `skills.with({ allowed: ["deep-research"], fork: true })` installs a `forkSkill` tool — rather than as a route on the session-global `runSkill` router. New `createSkillsLibrary` options: `forkModelId` (the child's model, since a capability tool can't reach the host generator's resolved model) and `forkHistoryLimit` (bound the inherited history by whole turns). `createForkSkillTool` / `buildForkCatalogContext` are exported for custom wiring.

The fork route is removed from the session-global `runSkill` router; invoking a `context: fork` skill through `runSkill` now throws with a pointer to the `fork` preset.
