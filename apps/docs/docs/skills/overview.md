---
sidebar_position: 1
---

# Skills

`@flow-state-dev/skills` — Markdown playbooks the agent loads on demand. Each skill is a folder with a `SKILL.md` and (optionally) supporting files. When a skill activates, its body is rendered into the generator's system prompt as specialized instructions for one kind of task.

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

## Three activation modes

A skill that has been matched runs in one of three modes, declared in its frontmatter:

- **Inline** (default). The substituted skill body is injected into the parent generator's system prompt on the next step. The conversation continues in the parent context with the parent's tools.
- **Fork.** Activation spawns a sub-agent — a framework `generator` with `agentType: "sub"` — running the skill body with a resolved subset of catalog tools. The sub-agent's tool calls and output stream to the client for live observability but are excluded from the parent's conversation history.
- **Pattern.** Activation materializes a task board (or any registered pattern) with named workers running in parallel. Use this when a skill is best handled by a small team rather than a single agent. See [Pattern skills](./pattern-skills) for the frontmatter shape and the worker catalog.

Choose fork when the skill is a self-contained investigation that shouldn't bias the rest of the conversation. Choose inline when the user is collaborating with the agent and wants the guidance to persist. Choose pattern when the work decomposes naturally into independent sub-tasks that can run concurrently.

## Wiring it up

Add the capability to a generator via `uses:`. The capability installs a skills resource collection plus three presets (all on by default): `tools` (catalog tool schemas), `context` (the active-skill body formatter), and `runSkill` (the `runSkill` tool plus the catalog listing the model reads).

```ts
import { createSkillsCapability, readSkillsDirectory } from "@flow-state-dev/skills";
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
  agentType: "primary", // optional — see below
});
```

When you adopt up-front activation via `createSkillActivator`, drop the `runSkill` preset at the use site to skip the redundant tool-call path:

```ts
uses: [skillsCap.presets({ runSkill: false }), skillActivator, /* ... */]
```

Then attach it to any generator:

```ts
import { generator } from "@flow-state-dev/core";

export const assistant = generator({
  name: "assistant",
  agentType: "primary",
  model: "preset/medium",
  prompt: "You are a helpful assistant. Active skills override defaults.",
  uses: [skillsCap],
});
```

The first time the collection is read (whether by `skillActivator` or by the catalog context formatter), the initial skills are seeded. Later edits to skill bodies — via DevTool, a CLI, or an admin UI — take effect on the next turn. There's no redeploy.

## Main-agent scoping with `agentType`

In multi-agent patterns like `planAndExecute`, `supervisor`, and `blackboard`, a coordinator delegates steps to workers. If the skills capability rides along into every worker, every step pays for skill context, and workers redundantly know about skills the coordinator is the one matching.

The `agentType` option on `createSkillsCapability` is an allowlist:

```ts
createSkillsCapability({ /* ... */, agentType: "primary" });
```

Set this way, the capability attaches only to generators with `agentType: "primary"` (or no `agentType` set, treated as primary). Workers tagged `agentType: "sub"` skip it. The default is undefined — the capability attaches everywhere.

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
| `createSkillsCapability(options)` | The one-line wiring path. Returns a capability with three presets — `tools`, `context`, `runSkill` — all on by default. Drop the tool-call path at the use site with `cap.presets({ runSkill: false })`. |
| `createSkillActivator(options)` | The up-front skill router. Returns a `.tap`-able sequencer. See [Activation paths](./activation). |
| `readSkillsDirectory(root)` | Walk a filesystem tree and return `InitialSkill[]` for `initialSkills`. Node only. |
| `createRunSkillTool(options)` | The `runSkill` router as a standalone tool, for custom wiring outside the capability. |
| `createSkillForkGenerator(options)` | The fork-mode generator, for custom wiring. |
| `inlineActivate` | The inline-mode handler, for custom wiring. |
| `parseSkillMd`, `serializeSkillMd` | Frontmatter + body parsing, for tools that build skills programmatically. |
| `skillActivationSourceSchema`, `matchedSkillSchema` | Runtime Zod schemas mirroring the `SkillActivationSource` / `MatchedSkill` types from `@flow-state-dev/core`. |

Continue to [Activation paths](./activation) for up-front vs. mid-flow, or [Authoring skills](./authoring) for the SKILL.md format reference.
