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
uses. That prompt is what tells the agent to keep a to-do list as it works, among much else, so
a run started this way behaves like the agent you know from the terminal.

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
says. It will still have its tools, but nothing tells it to keep a to-do list, so with
`recordWork` on the plan record usually stays empty. Use a string when you want that narrow
agent; use `append` when you want to add a line.

`""` starts the run with no system prompt at all. The value is forwarded to the Agent SDK as
given, so any shape the SDK accepts works here, and the SDK rejects one it doesn't.

## UPDATE · `apps/docs/docs/tools/claude-code-sdk.md` · "Reading it back", after "The plan record reads the same way"

The plan record fills only when the agent keeps a to-do list. It does when the run starts from
Claude Code's own prompt, with or without `append`. A run given its own prompt string usually
writes its plan as prose instead, and the record stays empty. That is the honest answer, not a
recording failure, and nothing appears in `observed-gaps` for it.

## UPDATE · `packages/claude-code/README.md` · "Recording what a run did", after the code block

The plan half fills when the agent keeps a to-do list, which it does when the run starts from
Claude Code's own prompt. That is the default when `systemPrompt` is left out. To add
instructions, use `systemPrompt: { type: "preset", preset: "claude_code", append: "…" }`. A
plain string replaces Claude Code's prompt and usually leaves `observed-plan` empty; `""` starts
the run with no system prompt.

## UPDATE · `.changeset/*.md` · `@flow-state-dev/claude-code` minor

> `claudeCodeAgent` now starts a run from Claude Code's own system prompt when `systemPrompt` is
> left out, matching the `claude` CLI, and accepts the Agent SDK's preset form to add
> instructions with `append`. Runs that relied on starting with no system prompt pass
> `systemPrompt: ""`.

## Publication ownership

FIX-1185 publishes these four operations after V2 and the goal check pass. It does not edit
`coding-agents.md`: the harness contract is unchanged.
