---
sidebar_position: 1
---

# Skills

`@flow-state-dev/skills` — A tool-invoked playbook system. Skills are Markdown files that the agent can load on demand, giving the model specialized instructions and an optional subset of tools for one kind of task.

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

The `SKILL.md` has YAML frontmatter (a description, plus optional settings) and a Markdown body with the playbook. Supporting files in the same folder (like `reference/methodology.md`) are bundled with the skill and can be referenced from the body.

Skills are not auto-matched. The model chooses when a skill applies by calling a tool — `runSkill` — with the skill's name. This is the key contract: you pay the context cost of a skill's body only when the model decides it's relevant.

## When to use a skill vs a capability

Both skills and capabilities extend what a generator can do. They solve different problems.

- **Capability.** Code that ships with the app. Bundles resources, tools, context formatters, and helper functions. Every turn, the capability's context and tools flow into the generator whether the user's question needs them or not.
- **Skill.** Markdown authored by anyone, editable at runtime. Loaded into the generator's system prompt only when the model invokes `runSkill`.

Reach for a capability when the behavior is always on and needs structured code (e.g. a memory store). Reach for a skill when the behavior is sometimes on, is mostly natural-language guidance, and benefits from being editable without a deploy. The two compose — the Skills package is itself shipped as a capability.

## Two activation modes

Every skill runs in one of two modes, declared in its frontmatter:

- **Inline** (default). Activation patches session state. The next turn's generator renders the substituted skill body into its system prompt and proceeds in the parent context with the parent's tools. Inline is the right default for guidance-style skills.
- **Fork.** Activation spawns a subagent — a framework `generator` with `agentType: "sub"` — running the skill body as its system prompt, with a resolved subset of the catalog tools. The subagent's tool calls and output stream to the client for live observability but are excluded from the parent's conversation history. Fork is right for one-shot tasks where you want isolation and a clean return value.

Choose fork when the skill is a self-contained investigation that shouldn't bias the rest of the conversation. Choose inline when the user is continuing to collaborate with the agent and wants the skill's guidance to shape ongoing responses.

## Wiring it up

Add the capability to a generator via `uses:`. The capability installs a skills resource collection, a dynamic context formatter listing available skills, the `runSkill` tool, and a session-state slice for active skills.

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
  scope: "project",
  agentType: "primary", // optional — see below
});
```

Then attach it to any generator:

```ts
import { generator } from "@flow-state-dev/core";

export const assistant = generator({
  name: "assistant",
  agentType: "primary",
  model: "preset/medium",
  prompt: "You are a helpful assistant. When a skill matches the request, call runSkill.",
  uses: [skillsCap],
});
```

The first time `runSkill` executes, the initial skills from `readSkillsDirectory()` are seeded into the collection. Later edits to skill bodies (via DevTool, a CLI command, or an admin UI) take effect on the next turn. There's no redeploy.

## Main-agent scoping with `agentType`

In multi-agent patterns like `planAndExecute`, `supervisor`, and `blackboard`, a coordinator delegates steps to workers. If the skills capability rides along into every worker, every step pays the token cost of skill catalog context, and workers redundantly "know" about skills the main agent is the one coordinating.

The `agentType` option on `createSkillsCapability` is an allowlist:

```ts
createSkillsCapability({ /* ... */, agentType: "primary" });
```

Set this way, the capability attaches only to generators with `agentType: "primary"` (or no `agentType` set, which is treated as primary). Workers tagged `agentType: "sub"` skip it. The default is undefined — the capability attaches everywhere, matching existing behavior.

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

## How a turn plays out

1. The generator renders its system prompt. The skills capability adds a catalog listing — the names and descriptions of every enabled skill.
2. The model decides the user's request matches one of those descriptions and calls `runSkill` with the skill's name (and optionally an argument string).
3. The `runSkill` router reads the skill from the resource collection, substitutes `$ARGUMENTS` and `${CLAUDE_SKILL_DIR}` in the body, then dispatches to inline or fork mode.
4. Inline mode patches session state; the next generator step's dynamic context formatter renders the substituted body into the system prompt. Fork mode runs the skill body as a sub-agent generator and returns its final text.
5. The model continues with the playbook now in context.

The trigger is the skill's `description`. Write it well.

## What ships in the package

| Export | Purpose |
|--------|---------|
| `createSkillsCapability(options)` | The one-line wiring path. Returns a defined capability. |
| `readSkillsDirectory(root)` | Walk a filesystem tree and return `InitialSkill[]` for `initialSkills`. Node only. |
| `createRunSkillTool(options)` | The `runSkill` router as a standalone tool, for custom wiring outside the capability. |
| `createSkillForkGenerator(options)` | The fork-mode generator, for custom wiring. |
| `inlineActivate` | The inline-mode handler, for custom wiring. |
| `parseSkillMd`, `serializeSkillMd` | Frontmatter + body parsing, for tools that build skills programmatically. |

Continue to [Authoring skills](./authoring) for the SKILL.md format reference.
