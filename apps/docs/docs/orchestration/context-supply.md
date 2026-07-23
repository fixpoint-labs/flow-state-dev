---
title: Context supply
sidebar_position: 5
sidebar_label: Context supply
description: How a delegated agent inherits prior conversation — the fork-like context mode, and why forking here is a property of delegation rather than a skill setting.
---

# Context supply

When a skill hands work to one of its agents, that agent runs as its own generator with its own conversation. By default it sees only the task it was given. It does not see the discussion that led up to the task.

Sometimes that is exactly wrong. The agent needs to know what was already said, but you still don't want its step-by-step work piling up in the main agent's memory. Getting both at once is what people usually call "forking" a conversation: inherit everything up to now, do a pile of work, hand back only the answer.

In some skill systems forking is a mode you flip on a skill. Here it is not. Forking is a property of how you delegate, set by one field on the agent you delegate to. This page explains the two levers that decide what a delegated agent inherits, and how to get fork-like behavior from them.

## What "fork" usually means

In a typical skill system, a skill declares a mode ("this one forks"), and activating the skill spins up an isolated sub-run seeded with the current conversation. The mode lives on the skill: the skill decides how it executes.

That coupling is the thing the wider skills redesign moved away from. A skill should describe *what* it knows and *who* is on its team, not *how* the runtime executes it.

## Delegation is the primitive

In FSD, a skill delegates by declaring a team under `agents:` and commanding it through a task board. The skill's generator gets a small set of board tools: it plans work with `addTask` (naming an agent as the assignee) and runs the whole graph with `runBoard`. Each agent runs as a board worker with its own generator.

Because delegation goes through the board, "fork" cannot be a skill-level switch. There is no skill mode to flip. What varies between agents is how much context each one is handed, so that is where the knob lives: on the agent.

Two independent levers decide what a delegated agent sees and what it contributes back.

**`itemVisibility`** is the output lever. It controls what an agent's own items do after they are produced: whether they stream to the client (`client`) and whether they re-enter the parent's model history (`history`). A board worker defaults to `{ client: true, history: false }`: you can watch it work, but its intermediate steps never bloat the host's context window. Only its returned result comes back.

**Context supply** is the input lever. It controls how much prior conversation the agent reads before it starts. That is the subject of this page.

A third, related lever, [flow policy](./flow-policy), governs a different kind of input: the prior *tool-call observations* from other workers in the same run. Flow policy and context supply are orthogonal. One replays messages, the other replays tool results. An agent can use either, both, or neither.

## Fork-like: a conversation-supply agent

Set `context-supply: conversation` on an agent and it inherits the parent conversation up to the point it was dispatched, then diverges on its own. Leave the field off (or set `isolated`) and it sees only its task input, which is the default.

```yaml
agents:
  summarizer:
    prompt: Summarize the discussion into a short brief.
    context-supply: conversation   # inherit the conversation so far
  extractor:
    prompt: Pull the action items out of the task you are given.
    # no context-supply -> isolated: sees only its task input
```

The `summarizer` above is fork-like. It reads the conversation that already happened, produces a brief, and only that brief re-enters the host's history. Its own reasoning stays out, because output isolation (`itemVisibility.history: false`) is unchanged by the input lever. Inherit in, isolate out.

The inherited window is **bounded by default**. A conversation agent inherits the last several whole turns, not the entire session. Full, unbounded inheritance is the failure mode discussed below, so the default caps it; a per-agent bound is a planned extension.

### The low-level equivalent

`context-supply` is a name for a shape you can already build by hand on a plain generator. A generator's `history` slot pulls prior conversation into its prompt, and `itemVisibility` decides what its output contributes:

```ts
const forked = generator({
  model: "openai/gpt-5.4-mini",
  history: true,                                     // inherit the conversation so far
  itemVisibility: { client: true, history: false }, // keep its own steps out of host history
  prompt: "Summarize the discussion into a short brief.",
});
```

That is the mechanism `context-supply: conversation` wires up for a declared agent. You reach for the field, not this, when the participant is authored as portable skill data rather than hand-written code. (Note the field lives on the agent, not on `generator(...)`; a generator uses `history` and `itemVisibility` directly.)

## Why context supply is a delegation property, not a skill mode

One substrate owns delegation, and context supply rides on it. Every agent, in every skill, gets the same knob, resolved the same way. There is no per-skill fork mode to learn, and no second path for "the forking kind of skill" versus the rest.

The tradeoff is that forking is no longer a one-word switch on the skill. You declare an agent, mark it conversation-supplying, and delegate to it. That is a little more to write than a single flag. In exchange, the behavior composes with everything else the agent surface already does: personas, model selection, tools, output visibility, and the task board that sequences the work.

## When not to fork

Inheriting the conversation is opt-in for a reason. Handing a long history to a small, focused agent is often counterproductive:

- **Context rot.** Model quality degrades as the input grows. A worker asked to do one narrow thing does it better on a tight prompt than on the whole transcript.
- **Distraction.** Irrelevant earlier turns pull a worker off the specific task it was given.
- **Cost and latency.** Every inherited turn is tokens paid on every step the worker takes.

Reach for `context-supply: conversation` when the agent genuinely needs the prior discussion to do its job (summarize it, answer a follow-up about it, continue a thread). For independent work that only needs its task input, leave it isolated. That default is the safe pick.

## Differences at a glance

| | Typical skill system | FSD |
|---|---|---|
| Where "fork" lives | a mode on the skill | a field on the delegated agent |
| How you turn it on | activate a fork-mode skill | `context-supply: conversation` on an agent |
| What inherits the conversation | the whole skill run | the specific agent you marked |
| How much is inherited | often the full transcript | bounded by default |
| What the sub-run contributes back | varies | only its result (output stays isolated) |

## See also

- [Flow policy](./flow-policy) — the other input lever: prior tool-call observations, not conversation messages
- [Agents](./agents) — the full agent authoring surface `context-supply` sits on
- [Task substrate](./task-substrate) — the board that sequences delegated work
- [Delegation](../skills/delegation) — how a skill drives its board
