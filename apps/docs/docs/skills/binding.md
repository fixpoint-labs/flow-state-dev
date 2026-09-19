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

`createSkillsLibrary` returns a capability. You bind to it per generator with `.with({ ... })` — the flat builder that routes config (`active` / `allowed` / `activeState`) and the `dynamicActivation` preset in one call. (It's sugar over the `.config()` / `.presets()` primitives; either works, but `.with()` is the one-call form these examples use.) The library owns seeding: bundled `initialSkills` are seeded on a binding's first render, so even a generator that only preloads a static skill sees a populated catalog on turn 1.

:::note One skills surface per generator
`createSkillsLibrary` and the older `createSkillsCapability` both register a `skills` resource collection under the same key, so don't mount both on the same generator — the duplicate collection key fails loudly at build time. Pick the per-generator library or the session-global capability for a given generator, not both.
:::

## `with({ active })` — preload a skill

`active` is the one-line common case. Name the skills this generator should always have, and their bodies (plus the tools they declare) are in context from the start.

```ts
uses: [skills.with({ active: ["detailed-analysis", "cite-sources"] })];
```

- **The catalog rides along, not the skill's list.** A binding contributes the library's `catalog`. `allowed-tools` is validated against that catalog but never selects what gets contributed, so it is not the unit here. Two things decide what the generator actually ends up with. A library built with `registerCatalogTools: false` contributes no catalog tools at all and leaves registration to you, which is what the built-in worker kind does. And a generator that declares its own `tools:` gets exactly that list: declaring the slot at all is what raises the fence, so `tools: []` means no catalog tools, while omitting the slot lets the contributed catalog through. If you declare `tools:`, name the skill's tools there too. `loadSkill` and the delegation surface below are not tools from your catalog and arrive either way. See [Tools a capability contributes](../fundamentals/capabilities#capability-tools).
- **A preloaded skill can delegate.** If the skill declares an `agents:` field, binding it installs the delegation surface (a private board, the `taskTools`, and `runBoard`) on this generator. This is the one path where `allowed-tools` restricts rather than describes: the catalog keys it lists are the tools that can be assigned a task, and a skill that lists none makes the whole catalog assignable. `delegation: true`/`false` are explicit overrides of that default (install iff `agents:` is declared): `false` suppresses it, and `true` forces it on even when the skill declares no `agents:`, relying on the board's default worker. See [Delegation](./delegation).
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

- `allowed` is the set the load tool may pull from. Omit it for the whole catalog. Like `active`, it contributes those skills' declared tools so a loaded skill can call the tools its body references.

By default the activation is stored in the generator's **own block state** — request-scoped and private. So it stays with this generator, and it does not carry into the next turn. That's usually what you want for a mid-task pickup.

The `loadSkill` tool runs as a child of the generator, so it writes the generator's state through `ctx.parent`; the reader runs in the generator's own scope and reads it through `ctx.self`. Same container, two sides. See [Block state](/docs/advanced/block-state) for the addressing model. The binding installs that block-state field (`activeSkills`) for you — you don't declare a `stateSchema` on the generator. (If you already declare one referencing `activeSkillsArraySchema`, it dedups with the binding's contribution rather than colliding.) If you'd rather store the activation somewhere shared or durable, use an explicit `activeState` instead.

## `with({ activeState })` — put the activation somewhere shared or durable

Block state is private and request-scoped. When you want an activation to be shared between generators, to survive into the next turn, or to be written by something that runs before the generator, point it at an explicit field:

```ts
skills.with({
  activeState: { scope: "session", field: "activeAnalystSkills" },
  allowed: ["detailed-analysis", "cite-sources"],
});
```

- `scope` is `request`, `session`, `user`, or `org`. `session` / `user` / `org` persist across turns; `request` does not.
- `field` is the state key the activations live under. Two generators that name the same field share their activations — an explicit choice, not an accident.
- Set `allowed` when skills read from this field need tools. The binding validates those skills and makes the library's tool catalog available to the generator. Without `allowed` or `dynamicActivation`, skill bodies from the field can render, but catalog tools are unavailable.

Declare that field in the scope's state schema where it's **written**. The upstream matcher does this for you (see below). If code or the generator writes it, add the field to the writer's own `sessionStateSchema` (or the matching scope schema) with `activeSkillsArraySchema` as its shape. The reader tolerates an absent field — it just renders nothing — so reads never need the declaration, only writes that must persist do.

### Who writes the activation

Three writers, and the storage choice follows from which one you have:

- **The load tool** (the LLM, mid-turn) writes the generator's block state by default, or the explicit `activeState` field if you set one.
- **Code** writes an explicit `activeState` field directly (`ctx.session.patchState(...)`).
- **An upstream matcher** (`createSkillActivator`, the slash / keyword / classifier router) runs *before* the generator, so it can't reach a downstream generator's block state; that state doesn't exist until the block runs. It **requires** an explicit shared field, and it should be scoped to the binding's `allowed` set so a `/skill` hit for a skill this generator wasn't given doesn't land in the field. Reach for it when you want activation by rule rather than by the model's judgement: `/research` activates research whether or not the model would have picked it.

```ts
const activator = createSkillActivator({
  activeState: { scope: "session", field: "activeAnalystSkills" },
  allowed: ["detailed-analysis", "cite-sources"],
  // Seed the catalog before the tiers run — the matcher runs upstream of the
  // generator, so it can't rely on the binding reader's lazy seeding. Pass the
  // same `initialSkills` you gave `createSkillsLibrary`, or a fresh collection
  // scans an empty catalog on turn 1 and matches nothing.
  initialSkills,
});
```

## What renders, and when

The reader is a per-step context function. The generator re-runs it before every tool-loop step, so a skill the load tool writes mid-turn shows up on the *next* step of the same execution, not a later turn. Only `inline`-mode entries render as context. Each entry keeps its input argument (substituted into `$ARGUMENTS`) and its activation source (slash / keyword / classifier), so an argument-dependent skill still works and the badge keeps its label.

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
