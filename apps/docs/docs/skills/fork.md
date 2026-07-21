---
sidebar_label: Fork
---

# Fork skills

A fork skill is a fork in the road. The agent hands a chunk of work to a child, the child inherits the conversation up to that point, goes off and does the work on its own, and hands back a single answer. The child's scratch work never lands in the main conversation, so the parent's context window stays small.

That last part is the whole point. A long investigation — search, fetch, read, discard, repeat — can burn a lot of tokens and clutter the transcript. Run it in a fork and the parent keeps one clean tool result instead of the whole trail.

## The fork point

The "fork point" is where the child's inherited history stops. Concretely, it's the conversation as it stands when the model calls the fork tool. The child sees every prior completed turn — user messages, assistant replies, resolved tool calls — but not the fork call itself, and not any of the child's own subsequent work.

Two things fall out of that boundary, both on purpose:

- The still-in-flight fork tool call is excluded. A model rejects a tool call with no matching result, so inheriting a half-finished call would break the child's first request. Because the fork call hasn't completed yet, it's simply not in the inherited history.
- The child's own work is excluded from the *parent*. The child runs with `itemVisibility: { client: true, history: false }`: its steps stream to the client for observability but never enter the parent's history. So the parent's next turn contains none of the child's searching and fetching — only the fork's result.

## Declaring a fork skill

Add `context: fork` to the frontmatter. `allowed-tools` names the tools the child may call:

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

The body becomes the child's system prompt (frontmatter stripped, `$ARGUMENTS` and `${SKILL_DIR}` substituted). The inherited history sits between that system prompt and a final "run the skill" instruction.

## Installing it on a generator

Fork installs per generator through `createSkillsLibrary`'s `fork` preset. The preset adds a `forkSkill` tool; `allowed` names which fork skills that generator may call.

```ts
const skills = createSkillsLibrary({
  catalog,
  initialSkills,
  forkModelId: "openai/gpt-5.4-mini",
});

generator({
  model: "openai/gpt-5.4-mini",
  prompt: "You are a research assistant.",
  uses: [skills.with({ allowed: ["research"], fork: true })],
});
```

The model calls `forkSkill` with `{ name, input? }`. The tool resolves the named fork skill, substitutes its body, and spawns the child. Only the child's final text comes back, as the tool's result:

```json
{ "skill": "research", "mode": "fork", "result": "…the child's final answer…" }
```

Omit `allowed` to let the generator fork any fork skill in the catalog.

### The child's model

A capability tool can't reach the model its host generator resolved to, so a fork child doesn't run "on the same model as the parent." It runs on `forkModelId` (default `intent/chat`). Set it to whatever fits the forked work — often a smaller, faster model than the one driving the main conversation.

## Bounding inherited history

By default the child inherits all history up to the fork point. That's the honest default, but copying history into a child is uncached — the child builds its own prompt from scratch, so a long conversation costs real tokens on every fork.

For apps with long conversations, cap it with `forkHistoryLimit`. The bound is applied by whole turns, so a tool call and its result are never split:

```ts
createSkillsLibrary({
  catalog,
  initialSkills,
  forkHistoryLimit: { turns: 8 }, // last 8 turns; or { tokens: 4000 }
});
```

## Fork vs inline vs pattern

- **Inline** keeps the conversation in the parent. Reach for it when the skill is guidance the agent should carry forward.
- **Fork** peels work into a child and returns one result. Reach for it when the work is a self-contained investigation with a clean input and output.
- **Pattern** runs a team of workers. Reach for it when the work decomposes into independent sub-tasks.

See [Authoring skills](./authoring) for the frontmatter reference and [Activation paths](./activation) for how the inline and pattern paths dispatch.
