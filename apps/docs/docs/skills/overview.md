---
sidebar_position: 1
---

# Skills

`@flow-state-dev/orchestration` — Markdown playbooks the agent loads on demand. Each skill is a folder with a `SKILL.md` and (optionally) supporting files. When a skill activates, its body is rendered into the generator's system prompt as specialized instructions for one kind of task.

## What a skill is

A skill is a folder on disk with a `SKILL.md` at its root:

```
skills/
  check-news/
    SKILL.md
  competitor-analysis/
    SKILL.md
  research/
    SKILL.md
    reference/
      methodology.md
```

The `SKILL.md` has YAML frontmatter (a description, plus optional settings like `keywords`, `context`, `allowed-tools`) and a Markdown body with the playbook. Supporting files in the folder ride along and are reachable from the body via the `${SKILL_DIR}` substitution.

## When to use a skill vs a capability

Both extend what a generator can do. They solve different problems.

- **Capability.** Code that ships with the app. Bundles resources, tools, context formatters, and helper functions. Always on.
- **Skill.** Markdown authored by anyone, editable at runtime. Active only when matched.

Reach for a capability when the behavior is structural and always present (a memory store, an artifact system). Reach for a skill when the behavior is sometimes-on guidance that benefits from being editable without a deploy. The two compose — the Skills package itself is shipped as a capability.

## Two ways a skill activates

Skills are not always-on. Something has to decide a skill applies before its body lands in the system prompt.

- **Up-front (default in this package).** A small pre-generator router — `createSkillActivator` — classifies the user message and writes any matched skills into session state. The main generator runs once with the body already in context. Three tiers, in order: literal `/<skill-name>` slash match, local keyword scan, then a fast LLM classifier when the earlier tiers don't decide.
- **Mid-flow.** The agent sees a catalog of skills in its system prompt and calls a `runSkill` tool when one applies. Two provider hits per skill-active turn (decide, then run with skill in context).

Both paths can coexist. See [Activation paths](./activation) for the full breakdown — when to use which, the tier behavior, the preset toggles, and how to compose them.

## What a matched skill does

A matched skill is inline instructions. Its substituted body is injected into the parent generator's system prompt on the next step, and the conversation continues in the parent context with the parent's tools. That's the whole model.

A bound skill can additionally **delegate**: if it declares a `workers:` field, the generator gets a private task board plus one callable tool per worker, and it hands pieces of its work off to them. See [Delegation](./delegation) for the frontmatter shape and how the generator drives the workers.

Fork mode was removed. A skill no longer runs as an isolated sub-agent. For "run this as a sub-agent and get the result back," declare a worker and call it (that's a one-call round-trip); a sub-agent that inherits the conversation so far is planned separately.

## Binding skills to one generator

The activation paths above write into session-wide state that every generator in the conversation reads. That's fine for a single agent. In a multi-agent flow it means one agent's skill leaks into another's context, and an activation persists for the rest of the conversation.

When you want a skill to belong to **one** generator — declared where that generator is defined, carried only by it — reach for the per-generator binding: a shared `createSkillsLibrary` plus `generator({ uses: [skills.with({ active, dynamicActivation })] })`. The common case is a one-line declarative `active` list, with no activate/deactivate lifecycle. See [Per-generator binding](./binding) for the full surface.

## Wiring it up

Add the capability to a generator via `uses:`. The capability installs a skills resource collection plus three presets (all on by default): `tools` (catalog tool schemas), `context` (the active-skill body formatter), and `runSkill` (the `runSkill` tool plus the catalog listing the model reads).

```ts
import { createSkillsCapability, readSkillsDirectory } from "@flow-state-dev/orchestration";
import { search, fetch, crawl } from "@flow-state-dev/tools";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skillsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "./skills",
);
const { skills: initialSkills } = await readSkillsDirectory(skillsDir);

export const skillsCap = createSkillsCapability({
  catalog: { search: search(), fetch: fetch(), crawl: crawl() },
  initialSkills,
  scope: "user",
  itemVisibility: { client: true, history: true }, // optional — see below
});
```

When you adopt up-front activation via `createSkillActivator`, drop the `runSkill` preset at the use site to skip the redundant tool-call path:

```ts
uses: [skillsCap.with({ runSkill: false }), skillActivator, /* ... */]
```

Then attach it to any generator:

```ts
import { generator } from "@flow-state-dev/core";

export const assistant = generator({
  name: "assistant",
  itemVisibility: { client: true, history: true },
  model: "preset/medium",
  prompt: "You are a helpful assistant. Active skills override defaults.",
  uses: [skillsCap],
});
```

The first time the collection is read (whether by `skillActivator` or by the catalog context formatter), the initial skills are seeded. Later edits to skill bodies — via DevTool, a CLI, or an admin UI — take effect on the next turn. There's no redeploy.

## Main-agent scoping with `itemVisibility`

In multi-agent patterns like `planAndExecute`, `supervisor`, and `blackboard`, a coordinator delegates steps to workers. If the skills capability rides along into every worker, every step pays for skill context, and workers redundantly know about skills the coordinator is the one matching.

The `itemVisibility` option on `createSkillsCapability` is an allowlist:

```ts
createSkillsCapability({ /* ... */, itemVisibility: { client: true, history: true } });
```

Set this way, the capability attaches only to generators with `itemVisibility: { client: true, history: true }` (or no `itemVisibility` set, treated as full visibility). Workers tagged `itemVisibility: { client: true, history: false }` skip it. The default is undefined — the capability attaches everywhere.

## Feature-flag gating

Wrap the capability in a dynamic `uses:` entry to gate it on a session flag. Users can toggle skills off when they want a plain chat:

```ts
import { defineCapability, type CapabilityRef } from "@flow-state-dev/core";
import { z } from "zod";

export const featuresCapability = defineCapability({
  name: "features",
  sessionStateSchema: z.object({
    features: z.object({ skills: z.boolean().default(true) }).default({}),
  }),
  uses: [
    (ctx) => {
      const caps: CapabilityRef[] = [];
      if (ctx.session.state.features.skills) caps.push(skillsCap);
      return caps;
    },
  ],
});
```

See the [guide](/guides/adding-skills-to-your-app) for a complete walkthrough.

## What ships in the package

| Export | Purpose |
|--------|---------|
| `createSkillsCapability(options)` | The one-line wiring path. Returns a capability with three presets — `tools`, `context`, `runSkill` — all on by default. Drop the tool-call path at the use site with `cap.with({ runSkill: false })`. |
| `createSkillActivator(options)` | The up-front skill router. Returns a `.tap`-able sequencer. See [Activation paths](./activation). |
| `readSkillsDirectory(root)` | Walk a filesystem tree and return `InitialSkill[]` for `initialSkills`. Node only. |
| `createRunSkillTool(options)` | The `runSkill` router as a standalone tool, for custom wiring outside the capability. |
| `inlineActivate` | The inline-mode handler, for custom wiring. |
| `parseSkillMd`, `serializeSkillMd` | Frontmatter + body parsing, for tools that build skills programmatically. |
| `skillActivationSourceSchema`, `matchedSkillSchema` | Runtime Zod schemas mirroring the `SkillActivationSource` / `MatchedSkill` types from `@flow-state-dev/core`. |

Continue to [Activation paths](./activation) for up-front vs. mid-flow, or [Authoring skills](./authoring) for the SKILL.md format reference.
