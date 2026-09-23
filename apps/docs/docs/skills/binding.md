---
sidebar_position: 2
sidebar_label: Per-generator binding
---

# Binding skills to a generator

A skill binds to **one generator**, where that generator is defined, and only that generator carries it. Two generators in the same flow can hold different skills without seeing each other's, and there's no activate/deactivate lifecycle to track.

Reach for this whenever you know at build time which generator needs which skill. The session-wide alternative, [`createSkillsCapability`](../orchestration/configuration), puts activations in one bag every generator in the conversation reads, which suits a single agent and leaks between agents in a multi-agent flow.

## Library and binding

A **library** is the shared catalog: the skills themselves, installed once. A **binding** is per generator: which of those skills this generator has, and how.

```ts
import { createSkillsLibrary, readSkillsDirectory } from "@flow-state-dev/orchestration";

const { skills: initialSkills } = await readSkillsDirectory("./skills");

// The library — install it once, share it across generators.
const skills = createSkillsLibrary({
  catalog: { search, fetch },
  initialSkills,
});

// A binding — this generator preloads one skill, and nothing else has it.
const analyst = generator({
  name: "analyst",
  model: "openai/gpt-5.4-mini",
  prompt: "...",
  uses: [skills.with({ active: ["detailed-analysis"] })],
});
```

`createSkillsLibrary` returns a capability. You bind to it per generator with `.with({ ... })`, the flat builder that routes config (`active` / `allowed` / `activeState`) and the `dynamicActivation` preset in one call. It's sugar over the `.config()` and `.presets()` primitives; either works, and `.with()` is the one-call form these examples use.

The library owns seeding. Bundled `initialSkills` are seeded on a binding's first render, so even a generator that only preloads a static skill sees a populated catalog on turn 1.

:::note One skills surface per generator
`createSkillsLibrary` and `createSkillsCapability` both register a `skills` resource collection under the same key, so don't mount both on the same generator. The duplicate collection key fails loudly at build time. Pick the per-generator library or the session-global capability for a given generator, not both.
:::

## What tools the generator gets

A skill's `allowed-tools` does not answer this. That key describes the tools a skill's body is written around; it grants none of them. What the generator can call comes from the library's `catalog` and from the generator's own `tools:` slot.

A binding that contributes the catalog contributes all of it, never the subset any one skill names. Whether it contributes the catalog at all depends on how you bound the skills:

| Binding | Catalog tools on the generator |
|---|---|
| `with({ active: [...] })` | Yes |
| `with({ dynamicActivation: true })`, with or without `allowed` | Yes |
| `with({ activeState, allowed })` | Yes |
| `with({ activeState })`, no `allowed` and no `dynamicActivation` | No. Bodies written to that field still render |
| Any binding, on a library built with `registerCatalogTools: false` | No. You register the tools yourself |

A generator that declares `tools:` gets exactly the tools it names, whichever row it is on. `tools: []` means none.

Declaring the slot is what draws the line, not what you put in it. So if you declare `tools:`, name the skill's tools there too. [Tools a capability contributes](../fundamentals/capabilities#capability-tools) is the same rule for every capability.

`registerCatalogTools: false` turns off the grant, not the check. A bound skill's `allowed-tools` is still validated against the catalog, so a typo in a skill file is still reported.

`loadSkill` and the delegation surface are controls, not catalog tools. A `tools:` list never takes a control away: a generator with `tools: []` still has them.

Delegation is where `allowed-tools` does restrict: a delegating skill can assign a task only to a tool it lists, and a skill that lists none makes the whole catalog assignable. See [Delegation](./delegation).

## `with({ active })` — preload a skill

`active` is the one-line common case. Name the skills this generator should always have, and their bodies are in context from the start, along with the library's tool catalog.

```ts
uses: [skills.with({ active: ["detailed-analysis", "cite-sources"] })];
```

- **A preloaded skill can delegate.** If the skill declares an `agents:` field, binding it installs the delegation surface on this generator: a private board, the `taskTools`, and `runBoard`. The tools a task can be assigned to are the ones the skill lists in `allowed-tools`, or the whole catalog when it lists none. `delegation: true` and `delegation: false` override that default, which is to install the surface exactly when `agents:` is declared. `false` suppresses it; `true` forces it on with no `agents:`, relying on the board's default worker. See [Delegation](./delegation).
- **Fails loud on a typo.** A name that isn't a known skill throws at build time. Binding by name validates against the library's bundled `initialSkills`, so pass them to `createSkillsLibrary`; binding a name with no catalog to check against is itself an error.

## `with({ dynamicActivation })` — let the agent load a skill mid-turn

Sometimes the agent should decide. Turn on `dynamicActivation` and the generator gets a `loadSkill` tool: the model reads a catalog of loadable skills and calls the tool when one applies. The skill's body injects on the next step of the same turn.

```ts
const worker = generator({
  name: "worker",
  model: "openai/gpt-5.4-mini",
  prompt: "...",
  uses: [skills.with({ allowed: ["deep-research", "competitor-scan"], dynamicActivation: true })],
});
```

- `allowed` is the set the load tool may pull from. Omit it for the whole catalog. Either way the binding contributes the library's tool catalog, so a loaded skill can call the tools its body references. See [What tools the generator gets](#what-tools-the-generator-gets).
- The catalog the model reads is supplied as context, so the agent knows what it can load from its first step. With a long library that cost lands on every turn. Add `catalogContext: false` to the same call and the listing leaves the prompt; the agent finds skills through [discovery](../orchestration/discovery.md) instead, which it pays for only when it asks.

By default the activation is stored in the generator's **own block state**, which is request-scoped and private. So it stays with this generator, and it does not carry into the next turn. That's usually what you want for a mid-task pickup.

The binding installs that block-state field (`activeSkills`) for you, so you don't declare a `stateSchema` on the generator. (If you already declare one referencing `activeSkillsArraySchema`, it dedups with the binding's contribution rather than colliding.) See [Block state](/docs/advanced/block-state) for the addressing model. If you'd rather store the activation somewhere shared or durable, use an explicit `activeState` instead.

## `with({ activeState })` — put the activation somewhere shared or durable

Block state is private and request-scoped. When you want an activation to be shared between generators, to survive into the next turn, or to be written by something that runs before the generator, point it at an explicit field:

```ts
skills.with({
  activeState: { scope: "session", field: "activeAnalystSkills" },
  allowed: ["detailed-analysis", "cite-sources"],
});
```

- `scope` is `request`, `session`, `user`, or `org`. `session` / `user` / `org` persist across turns; `request` does not.
- `field` is the state key the activations live under. Two generators that name the same field share their activations, which is an explicit choice rather than an accident.
- Set `allowed` when skills read from this field need tools. The binding validates those skills and makes the library's tool catalog available to the generator. Without `allowed` or `dynamicActivation`, skill bodies from the field still render, but no catalog tools come with them. See [What tools the generator gets](#what-tools-the-generator-gets).

Declare that field in the scope's state schema where it's **written**. The upstream matcher does this for you (see below). If code or the generator writes it, add the field to the writer's own `sessionStateSchema` (or the matching scope schema) with `activeSkillsArraySchema` as its shape. An absent field renders nothing rather than failing, so only a write that must persist needs the declaration.

### Who writes the activation

The storage choice follows from what writes the activation:

- **The load tool** (the LLM, mid-turn) writes the generator's block state by default, or the explicit `activeState` field if you set one.
- **Code** writes an explicit `activeState` field directly (`ctx.session.patchState(...)`).
- **An upstream matcher** (`createSkillActivator`, the slash / keyword / classifier router) runs *before* the generator, so it can't reach a downstream generator's block state; that state doesn't exist until the block runs. It **requires** an explicit shared field, and it should be scoped to the binding's `allowed` set so a `/skill` hit for a skill this generator wasn't given doesn't land in the field. Reach for it when you want activation by rule rather than by the model's judgement: `/research` activates research whether or not the model would have picked it.

```ts
const activator = createSkillActivator({
  activeState: { scope: "session", field: "activeAnalystSkills" },
  allowed: ["detailed-analysis", "cite-sources"],
  // The matcher runs before the generator, so pass the same `initialSkills`
  // you gave `createSkillsLibrary`. Without them it scans an empty catalog on
  // turn 1 and matches nothing.
  initialSkills,
});
```

## What renders, and when

Skill bodies are re-resolved before every tool-loop step, so a skill the load tool writes mid-turn shows up on the *next* step of the same execution, not a later turn. Only `inline`-mode entries render as context. Each entry keeps its input argument (substituted into `$ARGUMENTS`) and its activation source (slash / keyword / classifier), so an argument-dependent skill still works and the badge keeps its label.

## Choosing a storage location

| You want | Use |
|---|---|
| A skill this generator always has | `with({ active })` |
| The agent to pick a skill mid-turn, kept private to this generator | `with({ dynamicActivation: true })` (block-state field installed for you) |
| An activation shared between generators, or surviving into the next turn | `with({ activeState: { scope, field } })` |
| An up-front matcher (slash / keyword / classifier) to feed a binding | `createSkillActivator({ activeState, allowed })` + the same `field` on the binding |

## Where to next

- **[Configuration](../orchestration/configuration)** — every `createSkillsLibrary` and `skills.with` field.
- **[Activation paths](./activation)** — up-front matching vs mid-flow, the tier behavior, and the matcher.
- **[Authoring skills](./authoring)** — the `SKILL.md` frontmatter and body format.
- **[Block state](/docs/advanced/block-state)** — the request-scoped, block-namespaced state the default binding uses.
