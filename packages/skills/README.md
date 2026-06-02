# @flow-state-dev/skills

Runtime implementation of the Skills System. Skills are user-modifiable folders (SKILL.md plus supporting files) stored as resources, invoked by the agent through a `runSkill` tool or matched up-front by `createSkillActivator`.

## Installation

```bash
pnpm add @flow-state-dev/skills
```

## Activation modes

A matched skill runs in one of three modes:

- **`inline`** (default) — the substituted body is injected into the parent generator's system prompt on the next step.
- **`fork`** — activation spawns a sub-agent (a framework `generator` with `agentType: "sub"`) running the body with a resolved subset of catalog tools.
- **`pattern`** — activation materializes a multi-agent pattern (task board, supervisor, etc.) with workers declared in frontmatter. See [Pattern skills](https://flow-state.dev/docs/skills/pattern-skills).

## Quick start

```ts
import { createSkillsCapability, readSkillsDirectory } from "@flow-state-dev/skills";
import { defaultPatternRegistry } from "@flow-state-dev/patterns";

const { skills: initialSkills } = await readSkillsDirectory("./skills");

export const skillsCap = createSkillsCapability({
  catalog: { /* tool catalog */ },
  initialSkills,
  scope: "user",
  // Optional — enables pattern skills.
  patternRegistry: defaultPatternRegistry,
});
```

Attach the capability to any generator via `uses: [skillsCap]`.

## `createSkillsCapability` options

| Option | Purpose |
|--------|---------|
| `collection` | Resource registry key. Default `"skills"`. |
| `catalog` | Tool catalog skills can reference by string key via `allowed-tools`. |
| `initialSkills` | Bundled defaults seeded on first runSkill call. |
| `scope` | Resource scope (`"org"`, `"user"`, `"session"`). Default `"org"`. |
| `forkModelId` | Override the default model used by fork-mode sub-agents. |
| `agentType` | Restrict the capability to blocks with a matching agent type. |
| `patternRegistry` | Enables pattern skills. Pattern factories from `@flow-state-dev/patterns` plug in here. |
| `blockRegistry` | Optional registry for `block-ref:` workers in pattern skills. |
| `taskTools` | Default `true` when `patternRegistry` is set. Pass `false` to skip composing the runtime mutation surface. |
| `agentRegistry` | Forward-compat slot for the Agents primitive (`agent-ref:` worker resolution). |
| `capabilityCatalog` | Forward-compat slot forwarded to a future `materializeAgent`. |

## `taskTools`

When `patternRegistry` is wired, the `taskTools` capability composes in by default. It exposes eight handler-shaped tools — `addTask`, `assignTask`, `completeTask`, `failTask`, `blockTask`, `cancelTask`, `updateTask`, `listTasks` — that mutate the active pattern's TaskCollection. With no pattern active each tool returns `{ ok: false, error: "no_active_pattern" }` rather than throwing.

## Exports

| Export | Purpose |
|--------|---------|
| `createSkillsCapability` | The one-line wiring path. |
| `createSkillActivator` | Up-front skill activator (slash + keyword + classifier tiers). |
| `readSkillsDirectory` | Walk a filesystem tree into `InitialSkill[]`. |
| `parseSkillMd`, `serializeSkillMd` | Frontmatter + body parsing, including pattern bindings. |
| `createPatternRegistry`, `materializeWorker`, `createPatternRunRoute` | Low-level pattern primitives, for custom wiring. |
| `taskTools`, `createTaskToolsCapability` | The runtime mutation surface. |
| `getActivePatternCollection` | Resolve the live TaskCollection of the active pattern skill. |

## Documentation

- [Skills overview](https://flow-state.dev/docs/skills/overview)
- [Activation paths](https://flow-state.dev/docs/skills/activation)
- [Authoring skills](https://flow-state.dev/docs/skills/authoring)
- [Pattern skills](https://flow-state.dev/docs/skills/pattern-skills)

## Running tests

```bash
pnpm --filter @flow-state-dev/skills test
```
