---
title: Context supply
sidebar_position: 6
sidebar_label: Context supply
description: "How a delegated agent inherits prior conversation: the context-supply field, the window it reads, and when to leave an agent isolated."
---

# Context supply

When a skill hands work to one of its agents, that agent runs as its own generator with its own conversation. By default it sees only the task it was given, not the discussion that led up to it.

Sometimes that's wrong. The agent needs to know what was already said, but you still don't want its step-by-step work piling up in the main agent's memory. Inherit everything up to now, do a pile of work, hand back only the answer. That's what people call "forking" a conversation, and forking here is one field on the agent you delegate to.

`itemVisibility` controls what a delegated agent's work contributes on the way out. Context supply controls what it reads on the way in.

## The levers

A skill delegates by declaring a team under `agents:` and commanding it through a task board. The skill's generator gets a small set of board tools: it plans work with `addTask` (naming an agent as the assignee) and runs the whole graph with `runBoard`. Each agent runs as a board worker with its own generator.

**`itemVisibility`** is the output lever. It controls what an agent's own items do after they are produced: whether they stream to the client (`client`) and whether they re-enter the parent's model history (`history`). A board worker defaults to `{ client: true, history: false }`, so you can watch it work but its intermediate steps never bloat the host's context window. Only its returned result comes back.

**Context supply** is the input lever. It controls how much prior conversation the agent reads before it starts. That is the subject of this page.

[Flow policy](./flow-policy) governs a different kind of input: the prior *tool-call observations* from other workers in the same run. Flow policy and context supply are orthogonal. One replays messages, the other replays tool results. An agent can use either, both, or neither.

## Fork-like: a conversation-supply agent

Set `context-supply: conversation` on an agent entry and it inherits the parent conversation up to the point it was dispatched, then diverges on its own. The field is set per agent, not per skill, so two agents in the same skill can differ. Leave it off and the agent sees only its task input, which is the default. There is no `isolated` value to set: omitting the field is how you get isolation.

`context-supply` applies to `prompt` and `prompt-ref` agents. Setting it on an `agent-ref` entry throws, at parse time and again at materialization.

```yaml
agents:
  summarizer:
    prompt: Summarize the discussion into a short brief.
    context-supply: conversation   # inherit the conversation so far
  extractor:
    prompt: Pull the action items out of the task you are given.
    # no context-supply -> isolated (the default): sees only its task input
```

The `summarizer` above is fork-like. It reads the conversation that already happened, produces a brief, and only that brief re-enters the host's history. Its own reasoning stays out, because output isolation (`itemVisibility.history: false`) is unchanged by the input lever. If you also mark that agent's output history-visible (`visibility: primary`, or `visibility: { client: true, history: true }`), its sub-work does re-enter the host's history and the isolation is gone.

The inherited window is bounded by default. A conversation agent reads the last 8 whole turns, not the entire session, and that bound is not configurable per agent. It counts turns rather than tokens, so 8 very long turns can still be a lot of context.

### The low-level equivalent

`context-supply` is a name for a shape you can already build by hand on a plain generator. A generator's `history` slot pulls prior conversation into its prompt, and `itemVisibility` decides what its output contributes:

```ts
const forked = generator({
  model: "openai/gpt-5.4-mini",
  history: { limit: { turns: 8 } },                  // inherit the last 8 whole turns
  itemVisibility: { client: true, history: false },  // keep its own steps out of host history
  prompt: "Summarize the discussion into a short brief.",
});
```

`context-supply: conversation` produces this shape for a declared agent, `turns: 8` included. Reach for the field rather than the generator when the participant is authored as portable skill data instead of hand-written code.

## When not to fork

Handing a long history to a small, focused agent is often counterproductive:

- **Context rot.** Model quality degrades as the input grows. A worker asked to do one narrow thing does it better on a tight prompt than on the whole transcript.
- **Distraction.** Irrelevant earlier turns pull a worker off the specific task it was given.
- **Cost and latency.** Every inherited turn is tokens paid on every step the worker takes.

Reach for `context-supply: conversation` when the agent genuinely needs the prior discussion to do its job: summarize it, answer a follow-up about it, continue a thread. For independent work that only needs its task input, leave it isolated.

## See also

- [Flow policy](./flow-policy) — the other input lever: prior tool-call observations, not conversation messages
- [Agents](./agents) — the full agent authoring surface `context-supply` sits on
- [Task board](./task-board) — the board that sequences delegated work
- [Delegation](../skills/delegation) — how a skill drives its board
