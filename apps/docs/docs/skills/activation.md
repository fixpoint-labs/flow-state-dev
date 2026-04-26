---
sidebar_position: 2
---

# Activation paths

A skill can become active in two ways:

- **Up-front**, before the main generator runs, via `createIntentSelector`. A small router classifies the user message and writes the matched skills into session state. The generator runs once with the skill body already in its system prompt.
- **Mid-flow**, while the generator is running, via the `runSkill` tool. The model sees a catalog of skills in its system prompt, decides one applies, and emits a tool call to activate it. The generator re-enters with the skill body in context.

Most apps want the up-front path as the default and `runSkill` as an escape hatch the agent can use when it changes its mind mid-turn. This page covers both.

## Why two paths

The up-front path addresses three downsides of tool-call activation:

1. **Catalog cost on every turn.** The skill catalog listing has to live in the system prompt for the model to know what's available, even when no skill applies. Prompt caching mitigates this; the up-front path eliminates it.
2. **Two provider hits per skill-active turn.** The first call decides on a skill and emits the tool call; the second runs with the skill in context.
3. **No knowledge of the active skill before the generator starts.** That blocks routing decisions in earlier blocks (e.g. picking a different pipeline based on the matched skill).

The tool-call path is still the right choice when activation is fluid (the agent decides several steps in) or when you don't want to add a classifier call to the front of every turn. They compose — see below.

## Up-front: `createIntentSelector`

```ts
import { createIntentSelector } from "@flow-state-dev/skills";

export const intentSelector = createIntentSelector({
  scope: "user", // matches the skills capability's scope
});
```

The result is a `.tap`-able sequencer. Insert it ahead of your main generator in a flow:

```ts
const runSequencer = sequencer({ name: "run", inputSchema })
  .tap(applyRequestedMode)
  .tap(intentSelector)
  .then(assistantGenerator);
```

It reads `input.message`, decides what (if any) skills apply, and writes the result into both request and session state. The generator that runs after sees activated skills already in its system prompt.

### Three tiers

`intentSelector` runs three tiers in order, each gated by whether an earlier tier already resolved:

1. **Slash match.** If the message starts with `/<skill-name>`, look up the skill in the collection and activate it. Deterministic, no LLM call. The argument tail (`/check-news quantum computing`) becomes `$ARGUMENTS` in the body.
2. **Keyword scan.** Each skill's `keywords` frontmatter is matched as plain substrings against the lowercased message. Every skill whose keywords match activates with `source: "keyword"`. Local, no LLM call.
3. **LLM classifier.** A `preset/fast` generator with structured output looks at the skill descriptions and decides whether any apply. Runs only when tiers 1 and 2 didn't resolve. Catalog-validated and confidence-gated (default 0.65).

A turn that hits tier 1 or 2 pays no LLM cost for the classification. A turn that falls through pays one fast-model call.

### Options

```ts
createIntentSelector({
  // Resource registry key for the skills collection. Default "skills".
  collectionKey: "skills",
  // Scope to read the collection from. Must match the skills capability.
  scope: "user",
  // Model the tier-3 classifier uses. Default "preset/fast".
  classifierModel: "preset/fast",
  // Per-match confidence threshold (0..1). Default 0.65.
  confidenceThreshold: 0.65,
  // Cap on skills described in the classifier prompt. Default 20.
  maxSkillsInClassifier: 20,
  // Skip tier 3 entirely (deterministic-only). Default true.
  enableLlmClassifier: true,
});
```

Set `enableLlmClassifier: false` in tests that shouldn't depend on a mocked classifier, or in deployments that prefer slash + keyword only.

### Drop the tool-call path

When a flow uses `intentSelector`, the `runSkill` tool and the catalog context formatter are redundant — the up-front path activates skills before the model has anything to call. The capability ships them in a `runSkill` preset that you opt out of with the standard preset overrides:

```ts
import { createSkillsCapability, createIntentSelector } from "@flow-state-dev/skills";

export const skillsCap = createSkillsCapability({
  catalog: { /* ... */ },
  initialSkills,
  scope: "user",
});

export const intentSelector = createIntentSelector({ scope: "user" });

// At the use site:
//   uses: [skillsCap.presets({ runSkill: false }), intentSelector, ...]
```

The active-skill body formatter lives on a separate `context` preset that stays on by default — that's how matched skills get their substituted body into the system prompt. Dropping `runSkill` only removes the catalog listing and the tool itself.

### Active-skill state

`intentSelector`'s apply step writes the matched skills to `session.state.__activeSkills` — the same slot the active-skill body formatter reads on every generator step. Each entry carries `{ name, mode, input, activatedAt, source }`. The `source` field is what `intentSelector` sets to record which tier matched; entries pushed by mid-flow `runSkill` calls leave it undefined.

`__activeSkills` is **replaced** each turn by `intentSelector`, not appended. If a flow keeps the `runSkill` preset on and the agent calls `runSkill` mid-turn, that call appends on top of the up-front baseline using the existing dedup-by-name+mode logic.

### Showing the active skill in your UI

Project `__activeSkills` through your flow's `clientData` to the surface shape your UI wants:

```ts
session: {
  stateSchema: sessionStateSchema,
  clientData: {
    modeStatus: (ctx) => {
      const active =
        (ctx.state as { __activeSkills?: Array<{ name: string; source?: string }> })
          .__activeSkills ?? [];
      return {
        // ... other fields
        activeSkills: active.map((s) => ({ name: s.name, source: s.source ?? "tool" })),
      };
    },
  },
},
```

The kitchen-sink renders one badge per active skill in its top bar with the skill name and the matching tier (`slash` / `keyword` / `classifier`, or `tool` for runSkill-driven activations).

## Mid-flow: `runSkill`

The original tool-call path. The capability's `runSkill` preset is on by default, so the only thing you need to do to use it is attach the capability.

The skills capability registers two pieces:

- A dynamic context formatter that lists every enabled skill in the system prompt as `Available skills: - name: description`.
- The `runSkill` tool. The model calls it with `{ name, input? }`; the router resolves the skill from the collection and dispatches to inline or fork mode.

The model decides activation. Inline-mode activation patches `__activeSkills`; fork-mode runs the skill body as a sub-agent and returns its result.

This path is appropriate when:

- You don't want a classifier call on every turn.
- Skill activation is genuinely a model-side decision (the agent realizes mid-investigation it needs a skill).
- The flow is simple enough that the catalog prompt overhead doesn't matter.

## Composing both

You can keep `runSkill` bound while also using `intentSelector`. The up-front pass sets the baseline each turn; any agent-initiated mid-flow `runSkill` call appends on top. There's no gating between them — the escape hatch stays open.

This is useful when most turns benefit from up-front classification but you also want the agent to be able to activate something mid-investigation. Most flows don't need this; pick one path and stick with it.

## When to pick which

| You want… | Use |
|-----------|-----|
| Slash commands work deterministically | Up-front (only path that handles slash) |
| Cheapest possible system prompt | Up-front with `presets({ runSkill: false })` |
| Lowest latency on turns where no skill matches | Mid-flow (skip the classifier call) |
| Activation only when the agent realizes mid-investigation | Mid-flow |
| The pre-generator router needs to know the active skill | Up-front (`__activeSkills` is on session state before the generator runs) |
| Lowest moving parts | Mid-flow (it's just a tool) |

The up-front path is the recommended default. The kitchen-sink chat-agent flow ships with it wired in.
