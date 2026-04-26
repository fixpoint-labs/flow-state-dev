---
sidebar_position: 6
title: Adding skills to your app
---

# Adding skills to your app

Skills let you extend an agent's behavior with Markdown playbooks the model invokes on demand. This guide walks through adding them to an existing flow-state.dev app, using the two example skills from the kitchen-sink reference app as the running case.

By the end you'll have:

- A `skills/` directory at your app root with two example skills
- The skills capability wired into your assistant generator
- A feature flag letting users turn skills on or off
- The main-agent scoping set up correctly so workers in multi-agent patterns don't carry skill context

This guide assumes you already have an app with a generator that takes a user message. If you're starting from zero, finish [Building a Chat App](/guides/building-a-chat-app) first.

## Step 1: Install the package

```bash
pnpm add @flow-state-dev/skills
```

Everything lives there — the capability factory, the directory reader, and the primitives under it.

## Step 2: Author two skills

Create a `skills/` directory next to your flow definition and drop two folders in with `SKILL.md` files.

`skills/check-news/SKILL.md`:

```markdown
---
description: Answer questions about current events or breaking news. Use when freshness matters. Enforces recency discipline and cites publication dates.
keywords: [news, latest, breaking, today, current, happening, recent]
---

# Check News

When active:

- Include the current year (or today's date) in every search query.
- Reject sources older than 7 days for breaking news, 90 days for "current state" questions.
- Prefer primary sources (official statements, original reporting) over aggregators.
- Cite the publication date of every source in the response.

If the freshest source you could find is stale, open the answer with that caveat.
```

`skills/competitor-analysis/SKILL.md`:

```markdown
---
description: Produce a competitor analysis. Use for landscape, comparison, or "who competes with X" questions. Enforces structure and source hygiene.
keywords: [competitor, competitors, competition, compare, versus, landscape, market]
---

# Competitor Analysis

When active:

1. **Define the space.** One sentence: what category, who the user is.
2. **Pick competitors.** 3 to 6 across three tiers: direct, adjacent, and status-quo/DIY.
3. **Evaluate on 4 to 5 dimensions.** Pick axes that matter for the decision: use case, target user, pricing, distribution, momentum, differentiation, weaknesses.
4. **Ground in sources.** Search and fetch pricing pages, changelogs, funding news. Mark unverified claims.
5. **Close with a takeaway.** Who wins for which user, and the main tradeoff.

Distinguish observable facts, reported facts, and your inferences. Mark inferences explicitly.
```

Both are inline-mode skills. They don't set `context:` in frontmatter, so activation just patches session state and the next generator step renders the body into its system prompt.

The `keywords` field is consumed by the up-front router we wire in Step 5. Each token is a plain lowercased substring match against the user message — when one hits, the skill activates without an LLM call. Picking a few obvious tokens per skill cuts a fast-model classifier call on common phrasings. Leaving them out is fine; the classifier still picks up the skill from its description.

## Step 3: Load the skills at startup

In the module where you define your capabilities, load the directory:

```ts
// lib/capabilities.ts
import { createSkillsCapability, readSkillsDirectory } from "@flow-state-dev/skills";
import { search, fetch, crawl } from "@flow-state-dev/tools";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skillsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../skills",
);
const { skills: initialSkills, errors } = await readSkillsDirectory(skillsDir);

for (const { name, error } of errors) {
  console.warn(`[skills] failed to load "${name}":`, error.message);
}

const searchTool = search();
const fetchTool = fetch();
const crawlTool = crawl();

export const skillsCap = createSkillsCapability({
  catalog: {
    search: searchTool,
    fetch: fetchTool,
    crawl: crawlTool,
  },
  initialSkills,
  scope: "project",
  agentType: "primary",
});
```

A few notes:

- `readSkillsDirectory` is async. Top-level `await` works in ESM (which Next.js, modern Node, and bundlers all support). If your toolchain doesn't support it, wrap the module in an async initializer.
- `initialSkills` is lazy-seeded. The skills aren't written to the collection until the first `runSkill` call, so module load is cheap.
- `errors` is an array, not a throw. A single malformed skill doesn't block the rest from seeding.
- `scope: "project"` puts the skills in the project resource scope, shared across users. Use `"user"` for per-user skills, `"session"` mostly for tests.
- `agentType: "primary"` is explained in Step 5.

## Step 4: Attach the capability to your generator

```ts
// flow.ts
import { generator } from "@flow-state-dev/core";
import { skillsCap } from "./lib/capabilities";

export const assistant = generator({
  name: "assistant",
  agentType: "primary",
  model: "preset/medium",
  prompt: [
    "You are a helpful assistant.",
    "When the user's request matches a skill description, call runSkill.",
  ].join("\n"),
  uses: [skillsCap],
});
```

That's the whole wiring. By default, the capability installs:

- The `skills` resource collection
- A dynamic context formatter listing the enabled skills by name + description
- The `runSkill` tool as a router
- A `__activeSkills` session-state slice used by the active-skill body formatter

In this default shape, the model decides activation: it reads the catalog in its system prompt and calls `runSkill` when one applies. That's the mid-flow path. Step 5 swaps it out for the up-front path.

## Step 5: Activate skills up-front (recommended)

The mid-flow path costs one extra provider call per skill-active turn (decide, then run with the skill in context) and pays for the catalog listing on every turn. `createIntentSelector` runs a small router before the main generator that does the activation decision once, then the generator runs once with the skill body already in its system prompt.

Three tiers, each gated by whether an earlier tier resolved:

1. **Slash match.** `/check-news how is OpenAI doing?` activates `check-news` deterministically. No LLM call.
2. **Keyword scan.** Each skill's `keywords` frontmatter is matched as plain substrings of the lowercased message. No LLM call.
3. **LLM classifier.** A `preset/fast` generator with structured output decides when the earlier tiers don't. Confidence-gated and validated against the catalog so it can't hallucinate skill names.

Build an `intentSelector` next to your skills capability and opt out of the `runSkill` preset at the use site:

```ts
// lib/capabilities.ts
import {
  createIntentSelector,
  createSkillsCapability,
  readSkillsDirectory,
} from "@flow-state-dev/skills";

// ... readSkillsDirectory + tools as before ...

export const skillsCap = createSkillsCapability({
  catalog: { search: searchTool, fetch: fetchTool, crawl: crawlTool },
  initialSkills,
  scope: "user",
  agentType: "primary",
});

export const intentSelector = createIntentSelector({
  scope: "user", // must match the skills capability
});
```

The capability ships three presets — `tools`, `context`, `runSkill` — all on by default. The `runSkill` preset bundles the `runSkill` tool and the catalog listing the model reads. When activation is decided up-front, both become dead weight on every turn. Drop them at the use site:

```ts
// flow.ts
import { intentSelector, skillsCap } from "./lib/capabilities";

export const assistant = generator({
  name: "assistant",
  agentType: "primary",
  model: "preset/medium",
  prompt: "You are a helpful assistant. Active skills override defaults.",
  // The active-skill body formatter (in the `context` preset) stays on,
  // so matched skills still get their body injected.
  uses: [skillsCap.presets({ runSkill: false })],
});
```

`intentSelector` returns a `.tap`-able sequencer. Add it to your run-sequencer ahead of the assistant generator:

```ts
// flow.ts
import { intentSelector } from "./lib/capabilities";

const runSequencer = sequencer({ name: "run", inputSchema })
  .tap(applyRequestedMode)
  .tap(intentSelector) // <-- new
  .then(assistant);
```

That's it. Run the app and try the three tiers:

- `/check-news what happened today?` → tier 1 hits, no LLM classifier call.
- `What's the latest in AI?` → tier 2 matches `latest`, no LLM call.
- `Summarize the report I uploaded.` → no slash, no keyword match, tier 3 fires the classifier and decides nothing applies.

For a deeper breakdown of when to keep the mid-flow path or compose both, see [Activation paths](/docs/skills/activation).

## Step 6: Scope to the main agent

If you compose your assistant with multi-agent patterns (`planAndExecute`, `supervisor`, `blackboard`), the pattern factory wires a coordinator and workers. Without scoping, skills attach to both — every worker carries the skill catalog even though only the coordinator needs it to decide on activation.

The `agentType: "primary"` option turns the skills capability into an allowlist: attach only to blocks with `agentType: "primary"`, skip blocks with `agentType: "sub"`. Pattern factories tag their synthesizers as primary and their workers as sub, so this one line does the right thing for every pattern.

```ts
export const skillsCap = createSkillsCapability({
  // ...
  agentType: "primary",
});
```

If you don't use multi-agent patterns, leave this off. The capability defaults to attaching everywhere.

## Step 7: Gate behind a feature flag

Users sometimes want a plain chat with no playbook coloring the response. Put skills behind a feature flag users can toggle:

```ts
// capabilities.ts
import { defineCapability, type CapabilityRef } from "@flow-state-dev/core";
import { z } from "zod";

export const appCap = defineCapability({
  name: "app",
  sessionStateSchema: z.object({
    features: z
      .object({
        skills: z.boolean().default(true),
      })
      .default({}),
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

Then `uses: [appCap]` on your generator instead of `uses: [skillsCap]`. When `features.skills` is false in session state, `runSkill` disappears from the tool list on the next turn.

Dynamic `uses:` entries re-run each turn, so the feature flag takes effect immediately without a new session.

## Step 8: Make skill bundle files reachable from bash

Skills can bundle more than `SKILL.md` — reference docs, Python scripts, anything you want the agent to open at activation time. For those files to actually be readable inside the agent's workspace, put the bash capability on the generator alongside skills:

```ts
import { createBashCapability } from "@flow-state-dev/tools/bash";

export const bashCap = createBashCapability({
  provider: { type: "local" },
});
```

That's the whole config. Bash auto-discovers every collection installed on the block and mounts each at its pattern prefix — so `skills/**` becomes `/workspace/skills/<skill-name>/<relpath>` with no additional wiring. `${CLAUDE_SKILL_DIR}` in skill bodies resolves to that path.

Attach both to your generator:

```ts
const assistant = generator({
  name: "assistant",
  uses: [skillsCap, bashCap],
  // ...
});
```

With the two caps together, the kitchen-sink's `check-news` skill can run a bundled Python helper directly:

```markdown
Before searching, compute today's date window:

python3 ${CLAUDE_SKILL_DIR}/scripts/date-window.py recent
```

And load topic-specific guidance from reference files:

```markdown
For AI questions, open: ${CLAUDE_SKILL_DIR}/reference/ai-news.md
For world events, open: ${CLAUDE_SKILL_DIR}/reference/world-events.md
```

By default, writes inside `/workspace/skills/` flush back to the skills collection — which means an agent CAN add or edit skills mid-run. If you want to lock that down, mount skills read-only:

```ts
createBashCapability({
  provider: { type: "local" },
  collections: [{ key: "skills", writable: false }],
});
```

If you don't use the bash capability, skip this step — reference files remain in the skills resource collection, just not on any filesystem path the agent can reach.

## Step 9: Let users edit skills at runtime

This is where the Markdown-as-resource design earns its keep. Skills live in the project-scoped `skills` collection. Any surface that can write to a resource can edit them:

- **DevTool** (built-in). Navigate to the skills collection, open a SKILL.md, edit, save. The next turn reflects the change.
- **CLI.** Use the client package to read and write resource content programmatically.
- **Admin UI.** If you build a CMS-style UI over your resources, skills show up automatically.

The seeding step runs once per collection lifetime — after the initial seed, bundled defaults in `initialSkills` don't overwrite user edits. New skills added to `initialSkills` (a new folder under `skills/`) get seeded on the next `runSkill` call since the seeding tracks which names have been written.

If you want to ship skill updates alongside code, the pattern most apps use is: edit the source file, bump a version, and run a migration that overwrites the resource content. The Skills package doesn't prescribe this; it just persists what's in the collection.

## Step 10 (optional): Fork mode for isolated tasks

Some skills are better as one-shot investigations than as guidance the agent carries forward. Add `context: fork` to the frontmatter:

```markdown
---
description: Deep research on a topic. Returns a structured report.
context: fork
allowed-tools: [search, fetch, crawl]
---

# Research

Given the topic: $ARGUMENTS

Search broadly, fetch the most promising sources, and return a structured
report with: background, key findings, open questions.
```

The `runSkill` router spawns a sub-agent generator (the framework's own `generator` block with `agentType: "sub"`) running the skill body as its system prompt with only the listed tools. The sub-agent's tool calls and streaming output reach the client for DevTool observability, but don't appear in the parent's conversation history.

The parent sees only a single `runSkill` tool call with the sub-agent's final text as its result.

## Verifying it works

Run the app. Open DevTool. Ask a question that should match a skill. What you should see depends on which path you wired:

**Up-front path (Step 5 wired in):**

1. An `intent-classifier` block appears in the trace timeline as `agentType: "trace"` (visible in DevTool, not in the conversation history). It only fires on tier-3 turns; slash and keyword matches skip it.
2. Session state's `__activeSkills` carries the matched skill for the duration of the turn.
3. The next generator step's system prompt contains the active-skill body inside a `<skills>` tag block — no separate catalog listing, no `runSkill` tool in the tool list.
4. If you wired the active-skills clientData projection, your top bar should show one badge per active skill labeled with the matching tier (`slash` / `keyword` / `classifier`).

**Mid-flow path (Step 5 skipped):**

1. The generator's tool list includes `runSkill` plus the catalog tools.
2. The system prompt includes the skills catalog — look for "Available skills: - check-news: ..." in the rendered system message.
3. When the model invokes `runSkill`, a new `tool_call_progress` item appears, and the next generator step's system prompt contains the activated skill's body.
4. Toggling `features.skills` off and asking again: `runSkill` is gone from the tool list, and the catalog section vanishes from the system prompt.

If a skill never activates on either path, the trigger is the description. The up-front path uses it for tier-3 classification; the mid-flow path puts it in the catalog the model scans. `keywords` cuts a classifier call but won't help a poorly-described skill activate at all.
