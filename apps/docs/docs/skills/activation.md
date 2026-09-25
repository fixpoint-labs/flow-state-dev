---
sidebar_position: 2
---

# Activation paths

A skill can become active in three ways:

- **Up-front**, before the main generator runs, via `createSkillActivator`. A small router classifies the user message and writes the matched skills into session state. The generator runs once with the skill body already in its system prompt.
- **Mid-flow**, while the generator is running, via the `runSkill` tool. The model sees a catalog of skills in its system prompt, decides one applies, and emits a tool call to activate it. The generator re-enters with the skill body in context.
- **Always on**, listed by name so the skill is in context every turn with no matching at all. There is no decision to get wrong and nothing to classify, so it costs one array merge — but you pay for the skill's body on every turn whether it applies or not.

Most apps want the up-front path as the default and `runSkill` as an escape hatch the agent can use when it changes its mind mid-turn. This page covers all three.

The [built-in worker kind](../workforce/built-in-worker.md#using-them) takes a subset, and describes it in the up-front path's own [matching tiers](#three-tiers) rather than in these three paths — so its page counts a tier where this one counts a path. A worker gets slash matching plus whatever it lists as always-on; the classifier tier is opt-in per worker, and so is the mid-turn tool.

## Why two paths

The up-front path addresses three downsides of tool-call activation:

1. **Catalog cost on every turn.** The skill catalog listing has to live in the system prompt for the model to know what's available, even when no skill applies. Prompt caching mitigates this; the up-front path eliminates it.
2. **Two provider hits per skill-active turn.** The first call decides on a skill and emits the tool call; the second runs with the skill in context.
3. **No knowledge of the active skill before the generator starts.** That blocks routing decisions in earlier blocks (e.g. picking a different pipeline based on the matched skill).

The tool-call path is still the right choice when activation is fluid (the agent decides several steps in) or when you don't want to add a classifier call to the front of every turn. They compose — see below.

## Up-front: `createSkillActivator`

```ts
import {
  createSkillActivator,
  readSkillsDirectory,
} from "@flow-state-dev/orchestration";

const { skills: initialSkills } = await readSkillsDirectory(skillsDir);

export const skillActivator = createSkillActivator({
  // The same bundled defaults you give the capability. The activator runs
  // before the generator, so it seeds the catalog itself — without this the
  // tiers scan an empty collection on the very first turn.
  initialSkills,
});
```

The result is a `.tap`-able sequencer. Insert it ahead of your main generator in a flow:

```ts
const runSequencer = sequencer({ name: "run", inputSchema })
  .tap(applyRequestedMode)
  .tap(skillActivator)
  .step(assistantGenerator);
```

It reads `input.message`, decides what (if any) skills apply, and writes the matches to `session.state.activeSkills`. The generator that runs after sees activated skills already in its system prompt.

### Three tiers

`skillActivator` runs three tiers in order, each gated by whether an earlier tier already resolved:

1. **Slash match.** If the message starts with `/<skill-name>`, look up the skill in the collection and activate it. Deterministic, no LLM call. The argument tail (`/check-news quantum computing`) becomes `$ARGUMENTS` in the body.
2. **Keyword scan.** Each skill's `keywords` frontmatter is matched as plain substrings against the lowercased message. Every skill whose keywords match activates with `source: "keyword"`. Local, no LLM call.
3. **Classifier.** Looks at the skill descriptions and decides whether any apply. Runs only when tiers 1 and 2 didn't resolve. By default an `intent/utility` generator with structured output does this; it can match several skills, each kept only above a confidence threshold (default 0.65). Pass an [evaluator](#tier-3-with-an-evaluator) and it picks instead.

A turn that hits tier 1 or 2 pays no LLM cost for the classification. A turn that falls through pays one fast-model call.

### Tier 3 with an evaluator

An [evaluator](/docs/fundamentals/blocks#evaluator--the-questions-you-already-know) is a block that asks an evaluation model a question with known answers. Give the activator one, and tier 3 asks it: which of these skills fits the message, or none?

```ts
import { createSkillActivator, skillEvaluator } from "@flow-state-dev/orchestration";

export const skillActivator = createSkillActivator({
  initialSkills,
  evaluator: skillEvaluator("typesafe-ai/jev"),
});
```

`skillEvaluator` takes any model an evaluator accepts: a model string, or an evaluation model such as `openai.evaluationModel("gpt-5.4-mini")`. See [Evaluation models](/docs/fundamentals/models#evaluation-models).

The activator offers the model the same skills the default classifier would see: the ones this binding allows, minus any with `disableModelInvocation`, up to `maxSkillsInClassifier`, each described by its `description` and `whenToUse`. It adds a "no skill" option, so the model never has to force a match. If the catalog is empty, no call is made.

What you get back is one skill or none. The model's pick is final:

- A pick activates that skill with `source: "classifier"`. Its `confidence` is the model's own number when the model reports one (Jev does), and missing when it doesn't (the OpenAI and Anthropic evaluation models don't). The activator doesn't compare it to a threshold, so `confidenceThreshold` is not accepted alongside `evaluator`.
- "No skill" activates nothing.
- An error fails the activator, the same way a failed default classifier does. It doesn't fall back to the default classifier. If you'd rather the turn go on without a skill, wrap the activator in [`.rescue`](/docs/sequencers/composing-blocks#rescue--catch-errors-route-to-recovery).

Two things work differently from the default classifier. It activates at most one skill per turn; keyword matches can still activate several. And it can't pull an argument out of the message, so `input` is empty. A slash command is still how a user passes `$ARGUMENTS`.

To name the block yourself, change what it evaluates, or give it `uses`, build it from `skillQuestions`:

```ts
import { evaluator } from "@flow-state-dev/core";
import { skillQuestions } from "@flow-state-dev/orchestration";

const pickSkill = evaluator({
  name: "pick-skill",
  model: "openai/gpt-5.4-mini",
  state: (input) => input.message,
  questions: skillQuestions,
});

createSkillActivator({ initialSkills, evaluator: pickSkill });
```

The activator passes the block `{ message, skills }` and reads its `skill` answer. A block that asks a different question fails the activator with an error that says so.

### Options

```ts
createSkillActivator({
  // Resource registry key for the skills collection. Default "skills".
  collectionKey: "skills",
  // Where resolved activations are written. Default { scope: "session",
  // field: "activeSkills" }. Point this at a binding's explicit activeState
  // field to feed a per-generator binding.
  activeState: { scope: "session", field: "activeSkills" },
  // Model the tier-3 classifier uses. Default "intent/utility".
  classifierModel: "intent/utility",
  // Per-match confidence threshold (0..1). Default 0.65.
  confidenceThreshold: 0.65,
  // Cap on skills described in the classifier prompt. Default 20.
  maxSkillsInClassifier: 20,
  // Skip tier 3 entirely (deterministic-only). Default true.
  enableLlmClassifier: true,
  // Use an evaluator for tier 3 instead of the default classifier. Can't be
  // combined with classifierModel, confidenceThreshold or enableLlmClassifier: false,
  // so it's commented out in this list of every option.
  // evaluator: skillEvaluator("typesafe-ai/jev"),
});
```

Set `enableLlmClassifier: false` in tests that shouldn't depend on a mocked classifier, or in deployments that prefer slash + keyword only.

### Drop the tool-call path

When a flow uses `skillActivator`, the `runSkill` tool and the catalog context formatter are redundant — the up-front path activates skills before the model has anything to call. The capability ships them in a `runSkill` preset that you opt out of with the standard preset overrides:

```ts
import { createSkillsCapability, createSkillActivator } from "@flow-state-dev/orchestration";

export const skillsCap = createSkillsCapability({
  catalog: { /* ... */ },
  initialSkills,
  scope: "user",
});

export const skillActivator = createSkillActivator({ initialSkills });

// At the use site:
//   uses: [skillsCap.with({ runSkill: false }), skillActivator, ...]
```

The active-skill body formatter lives on a separate `context` preset that stays on by default — that's how matched skills get their substituted body into the system prompt. Dropping `runSkill` only removes the catalog listing and the tool itself.

### Active-skill state

`skillActivator`'s apply step writes the matched skills to `session.state.activeSkills` — the same slot the active-skill body formatter reads on every generator step. Each entry carries `{ name, mode, input, activatedAt, source }`. The `source` field is what `skillActivator` sets to record which tier matched; entries pushed by mid-flow `runSkill` calls leave it undefined.

`activeSkills` is **replaced** each turn by `skillActivator`, not appended. If a flow keeps the `runSkill` preset on and the agent calls `runSkill` mid-turn, that call appends on top of the up-front baseline using the existing dedup-by-name+mode logic.

### Showing the active skill in your UI

Project `activeSkills` through your flow's `client.derived` to the surface shape your UI wants:

```ts
session: {
  stateSchema: sessionStateSchema,
  client: {
    derived: {
      modeStatus: (ctx) => {
        const active =
          (ctx.state as { activeSkills?: Array<{ name: string; source?: string }> })
            .activeSkills ?? [];
        return {
          // ... other fields
          activeSkills: active.map((s) => ({ name: s.name, source: s.source ?? "tool" })),
        };
      },
    },
  },
},
```

The kitchen-sink renders one badge per active skill in its top bar with the skill name and the matching tier (`slash` / `keyword` / `classifier`, or `tool` for runSkill-driven activations).

## Mid-flow: `runSkill`

The original tool-call path. The capability's `runSkill` preset is on by default, so the only thing you need to do to use it is attach the capability.

The skills capability registers two pieces:

- A dynamic context formatter that lists every enabled skill in the system prompt as `Available skills: - name: description`.
- The `runSkill` tool. The model calls it with `{ name, input? }`; the router resolves the skill from the collection and injects its body inline.

The model decides activation. Activation patches `activeSkills`, and the skill's body lands in the generator's prompt on the next step.

This path is appropriate when:

- You don't want a classifier call on every turn.
- Skill activation is genuinely a model-side decision (the agent realizes mid-investigation it needs a skill).
- The flow is simple enough that the catalog prompt overhead doesn't matter.

## Composing both

You can keep `runSkill` bound while also using `skillActivator`. The up-front pass sets the baseline each turn; any agent-initiated mid-flow `runSkill` call appends on top. There's no gating between them — the escape hatch stays open.

This is useful when most turns benefit from up-front classification but you also want the agent to be able to activate something mid-investigation. Most flows don't need this; pick one path and stick with it.

## When to pick which

| You want… | Use |
|-----------|-----|
| Slash commands work deterministically | Up-front (only path that handles slash) |
| Cheapest possible system prompt | Up-front with `presets({ runSkill: false })` |
| Lowest latency on turns where no skill matches | Mid-flow (skip the classifier call) |
| Activation only when the agent realizes mid-investigation | Mid-flow |
| The pre-generator router needs to know the active skill | Up-front (`activeSkills` is on session state before the generator runs) |
| Lowest moving parts | Mid-flow (it's just a tool) |

The up-front path is the recommended default. The kitchen-sink chat-agent flow ships with it wired in.
