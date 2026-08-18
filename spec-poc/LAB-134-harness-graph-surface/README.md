# POC — what a coding run's stream actually carries

**Throwaway. Nothing here ships.** It is on the spec branch so a reviewer can re-run it,
and it never merges.

## The question

LAB-134 proposes graphing a coding run's **file writes** and its **todo list** into FSD
state. The whole design rests on one premise: that both arrive as ordinary `tool_use`
blocks at the seam the translation layer already sees.

The Linear issue names the tools to look for as `Write`, `Edit`, `Read`, `TodoWrite`. That
list came from reading. This measures it.

## Run it

```
node spec-poc/LAB-134-harness-graph-surface/probe.mjs
```

Needs an authenticated `claude` on PATH. It runs one real, small coding job in a temp
directory (write a file, edit it, keep a two-item todo list), classifies every `tool_use`
block, and prints the three facts the spec rests on. It writes nothing outside the temp
directory and deletes it afterwards.

There is deliberately no captured-output file checked in. An earlier one drifted out of shape
against the probe and gave a false signal to anyone diffing the two; stdout is the artifact.

## What it showed

Measured twice, on `claude` **2.1.234** — the exact CLI version
`@anthropic-ai/claude-agent-sdk@0.3.234` pins in its `manifest.json`, so this is the binary
the SDK spawns, not a neighbour of it.

**1. File writes: the premise holds.** `Write` and `Edit` arrive as ordinary `tool_use`
blocks in the `assistant` message, carrying `file_path` on the tool **input**:

```
Write  input=[file_path, content]
Edit   input=[replace_all, file_path, old_string, new_string]
```

**2. The prose result and the structured result are two different fields, and only one of them
is prose.** `message.content[].tool_result.content` — what the model is shown — is the string
`"File created successfully at: …"`. But `tool_use_result`, a sibling field on the same user
message, carries the **full declared Output**: `type` (`create`/`update`), `filePath`,
`structuredPatch`. An earlier version of this POC measured only the content block and stated a
conclusion about "results", which was wider than the evidence. Read the structured field, and
fall back to the tool input.

**Not measured for the plan tools.** The two runs that logged `tool_use_result` kept no to-do
list, and the two runs that kept one predate the field being logged. Whether
`TaskCreateOutput.task.id` arrives as a typed field is genuinely open — re-run until a run
exercises both.

**3. The todo surface is not `TodoWrite`. That tool is not offered at all.**

```
TodoWrite offered?   false
plan tools offered   TaskCreate, TaskGet, TaskList, TaskUpdate
```

The run's todo list came through `TaskCreate` and `TaskUpdate`:

```
TaskCreate  {subject, description, activeForm}     -> "Task #3 created successfully: …"
TaskUpdate  {taskId, status}                       -> "Updated task #3 status"
```

`sdk-tools.d.ts` still declares `TodoWriteInput` — a whole-list snapshot,
`{content, status, activeForm}[]`, no ids. The shipped binary offers incremental per-item
CRUD with ids instead. Those are not two spellings of one thing; they are opposite data
models, and code written for either is silently inert against the other.

**4. A run may keep no to-do list at all.** Two of four runs created none — one of them after
being explicitly instructed to use the task tools; it called `ToolSearch` to find them and then
did the work without them. The plan surface is optional at the source, which is why the goal
check has to shape its job so planning is required and has to say *which* empty it hit.

**5. Todo ids are not positional.** The first captured run allocated `#1`/`#2`; the second
allocated `#3`/`#4` for the same two-item list. The counter is not per-run. So the id that
`TaskUpdate.taskId` references cannot be inferred from the order of `TaskCreate` calls — it
has to be correlated through each create's own result. The first run alone would have made
the positional inference look correct.

## Why this changed the spec

Two things, both in §6 and §7.

The vendor edge is **not** speculative multi-vendor engineering. One vendor changed its own
todo surface between two versions of one product, and the type declarations we depend on
still describe the old one. An adapter that isolates the tool-name knowledge is required
*today*, by observation, to survive that.

And it is the reason the spec's plan half is written to be **absent-tolerant**: a run that
uses neither surface, or a future one that uses a third, must degrade to an empty plan
rather than to a silent pass. See §10 — every assertion in the goal check has to be proved
able to fail, and "no plan tool fired" is the failure this POC exists to make visible.
