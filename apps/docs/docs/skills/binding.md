---
sidebar_position: 2
sidebar_label: Per-generator binding
---

# Binding skills to a generator

There are two ways to give a generator skills. The older one activates a skill into a session-wide bag that every generator in the conversation reads from. That works for a single agent, but in a multi-agent flow one agent's skill leaks into every other agent's context, and an activation sticks around for the rest of the conversation.

The per-generator binding fixes both. A skill binds to **one generator** where that generator is defined, and it's carried only by that generator. No shared bag, no activate/deactivate lifecycle to reason about.

## Library and binding

Two pieces. A **library** is the shared catalog: the skills themselves, installed once. A **binding** is per generator: which of those skills this generator has, and how.

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
  uses: [skills.config({ active: ["detailed-analysis"] })],
});
```

`createSkillsLibrary` returns a capability. You bind to it per generator with `.config({ ... })` and `.presets({ ... })`, the same two builders every capability has. The library owns seeding: bundled `initialSkills` are seeded on a binding's first render, so even a generator that only preloads a static skill sees a populated catalog on turn 1.

:::note One skills surface per generator
`createSkillsLibrary` and the older `createSkillsCapability` both register a `skills` resource collection under the same key, so don't mount both on the same generator — the duplicate collection key fails loudly at build time. Pick the per-generator library or the session-global capability for a given generator, not both.
:::

## `config({ active })` — preload a skill

`active` is the one-line common case. Name the skills this generator should always have, and their bodies (plus the tools they declare) are in context from the start.

```ts
uses: [skills.config({ active: ["detailed-analysis", "cite-sources"] })];
```

- **Inline-mode only.** `active` preloads a skill body. Fork and pattern skills are dispatch routes, not context injections, so they can't be preloaded here — they stay on the `runSkill` router (see [Pattern skills](./pattern-skills)).
- **Declared tools ride along.** Each preloaded skill contributes the tools it names in `allowed-tools`. A skill that declares none is unrestricted, so the whole catalog is contributed.
- **Fails loud on a typo.** A name that isn't a known skill throws at build time. This is an author declaration, not a runtime read, so a silent skip would run the generator without the instructions you asked for. Binding by name validates against the library's bundled `initialSkills`, so pass them to `createSkillsLibrary` — binding a name with no catalog to check against is itself an error.

Two generators, two different `active` sets, and neither sees the other's skill. That's the whole point.

## `presets({ dynamicActivation })` — let the agent load a skill mid-turn

Sometimes the agent should decide. Turn on `dynamicActivation` and the generator gets a `loadSkill` tool: the model reads a catalog of loadable skills and calls the tool when one applies. The skill's body injects on the next step of the same turn. (The catalog lists only inline skills, since the load tool loads inline bodies — fork/pattern dispatch stays on the v1 `runSkill` router.)

```ts
uses: [
  skills.config({ allowed: ["deep-research", "competitor-scan"] }).presets({
    dynamicActivation: true,
  }),
];
```

- `allowed` is the set the load tool may pull from. Omit it for the whole catalog. Like `active`, it contributes those skills' declared tools so a loaded skill can call the tools its body references.
- The load tool is **inline-only**. A fork or pattern skill in `allowed` is rejected.

By default the activation is stored in the generator's **own block state** — request-scoped and private. So it stays with this generator, and it does not carry into the next turn. That's usually what you want for a mid-task pickup.

### The block-state default needs a `stateSchema`

Block state belongs to the block, and today a capability can't hand a generator its own block-state field. So with the default (no explicit `activeState`), the generator has to declare where the activation lives:

```ts
import { activeSkillsArraySchema } from "@flow-state-dev/orchestration";

const worker = generator({
  name: "worker",
  model: "openai/gpt-5.4-mini",
  prompt: "...",
  stateSchema: z.object({ activeSkills: activeSkillsArraySchema }),
  uses: [skills.config({ allowed: ["deep-research"] }).presets({ dynamicActivation: true })],
});
```

The `loadSkill` tool runs as a child of the generator, so it writes the generator's state through `ctx.parent`; the reader runs in the generator's own scope and reads it through `ctx.self`. Same container, two sides. See [Block state](/docs/advanced/block-state) for the addressing model. If you'd rather not declare the field, use an explicit `activeState` instead.

## `config({ activeState })` — put the activation somewhere shared or durable

Block state is private and request-scoped. When you want an activation to be shared between generators, to survive into the next turn, or to be written by something that runs before the generator, point it at an explicit field:

```ts
skills.config({ activeState: { scope: "session", field: "activeAnalystSkills" } });
```

- `scope` is `request`, `session`, `user`, or `org`. `session` / `user` / `org` persist across turns; `request` does not.
- `field` is the state key the activations live under. Two generators that name the same field share their activations — an explicit choice, not an accident.

Declare that field in the scope's state schema where it's **written**. The upstream matcher does this for you (see below). If code or the generator writes it, add the field to the writer's own `sessionStateSchema` (or the matching scope schema) with `activeSkillsArraySchema` as its shape. The reader tolerates an absent field — it just renders nothing — so reads never need the declaration, only writes that must persist do.

### Who writes the activation

Three writers, and the storage choice follows from which one you have:

- **The load tool** (the LLM, mid-turn) writes the generator's block state by default, or the explicit `activeState` field if you set one.
- **Code** writes an explicit `activeState` field directly (`ctx.session.patchState(...)`).
- **An upstream matcher** — `createSkillActivator`, the slash / keyword / classifier router — runs *before* the generator, so it can't reach a downstream generator's block state (that state doesn't exist until the block runs). It **requires** an explicit shared field, and it should be scoped to the binding's `allowed` set so a `/skill` hit for a skill this generator wasn't given doesn't land in the field.

```ts
const activator = createSkillActivator({
  activeState: { scope: "session", field: "activeAnalystSkills" },
  allowed: ["detailed-analysis", "cite-sources"],
});
```

## What renders, and when

The reader is a per-step context function. The generator re-runs it before every tool-loop step, so a skill the load tool writes mid-turn shows up on the *next* step of the same execution, not a later turn. Only `inline`-mode entries render as context. Each entry keeps its input argument (substituted into `$ARGUMENTS`) and its activation source (slash / keyword / classifier), so an argument-dependent skill still works and the badge keeps its label.

## Choosing a storage location

| You want | Use |
|---|---|
| A skill this generator always has | `config({ active })` |
| The agent to pick a skill mid-turn, kept private to this generator | `presets({ dynamicActivation })` + a `stateSchema` field |
| An activation shared between generators, or surviving into the next turn | `config({ activeState: { scope, field } })` |
| An up-front matcher (slash / keyword / classifier) to feed a binding | `createSkillActivator({ activeState, allowed })` + the same `field` on the binding |

## Where to next

- **[Activation paths](./activation)** — up-front matching vs mid-flow, the tier behavior, and the matcher.
- **[Authoring skills](./authoring)** — the `SKILL.md` frontmatter and body format.
- **[Block state](/docs/advanced/block-state)** — the request-scoped, block-namespaced state the default binding uses.
