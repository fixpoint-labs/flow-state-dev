# FIX-1185 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Two destinations, both extended, no new page. The epic's shared narrative (the harness picker,
the plan panel) belongs to FIX-1914 and FIX-1915 and is not drafted here. Voice rules most at
risk for this topic: no internal issue numbers in `apps/docs`, few em-dashes, and introduce
"system prompt" in plain terms on first use.

## UPDATE · `apps/docs/docs/tools/claude-code-sdk.md` · "As a sequencer step"

Replace the example's `systemPrompt` line so the first example a reader copies keeps the run's
to-do list:

```ts
const agent = claudeCodeAgent({
  systemPrompt: {
    type: "preset",
    preset: "claude_code",
    append: "You are a careful refactoring assistant.",
  },
  allowedTools: ["Read", "Grep", "Edit"],
});
```

## UPDATE · `apps/docs/docs/tools/claude-code-sdk.md` · "Configuring the run", new subsection before `settingSources`

### The prompt the run starts from

A system prompt is the standing instruction the agent reads before your request. Leave
`systemPrompt` out and the run starts from Claude Code's own, the same one the `claude` command
uses, so a run started this way gets the same standing instructions as the agent you know from
the terminal.

To add your own instructions on top, append them:

```ts
claudeCodeAgent({
  systemPrompt: {
    type: "preset",
    preset: "claude_code",
    append: "Commit your work with git before you finish.",
  },
});
```

A plain string replaces Claude Code's prompt entirely. The agent then knows only what your string
says, though it still has its tools. Use a string when you want that narrow agent; use `append`
when you want to add a line.

`""` starts the run with no system prompt at all. The value is forwarded to the Agent SDK as
given, so any shape the SDK accepts works here, and the SDK rejects one it doesn't.

## UPDATE · `apps/docs/docs/tools/claude-code-sdk.md` · "Reading it back", after "The plan record reads the same way"

The plan record fills only when the agent keeps a to-do list with Claude Code's to-do tools,
`TaskCreate` and `TaskUpdate`. That takes two things. The run has to be offered the tools: on
newer models Claude Code switches them off unless you name them in `allowedTools`. And the agent
has to choose to use them, which it often doesn't on a short job, whatever prompt the run
started from. When it doesn't, the record stays empty. That is the honest answer, not a
recording failure, and nothing appears in `observed-gaps` for it.

## UPDATE · `packages/claude-code/README.md` · "Recording what a run did", after the code block

Leave `systemPrompt` out and the run starts from Claude Code's own system prompt, the same one
the `claude` CLI uses. To add instructions to it, use
`systemPrompt: { type: "preset", preset: "claude_code", append: "…" }`. A plain string replaces
it, and `""` starts the run with no system prompt.

The plan half fills only when the run is offered Claude Code's to-do tools (`TaskCreate`,
`TaskUpdate`) and the agent chooses to use them. Neither the default prompt nor `recordWork`
makes it. On newer models Claude Code switches those tools off unless they are named in
`allowedTools`, and even when they are offered the agent often works without a list. An empty
`observed-plan` means the run kept no list; it is not a recording failure.

## UPDATE · `.changeset/*.md` · `@flow-state-dev/claude-code` minor

> `claudeCodeAgent` now starts a run from Claude Code's own system prompt when `systemPrompt` is
> left out, the same one the `claude` CLI uses, instead of an empty one. It also accepts the
> Agent SDK's other prompt shapes, including the preset with `append` to add instructions. Runs
> that relied on starting with no system prompt pass `systemPrompt: ""`.

## Publication ownership

FIX-1185 publishes these four operations after V2 and the amended goal check pass. It does not edit
`coding-agents.md`: the harness contract is unchanged.
