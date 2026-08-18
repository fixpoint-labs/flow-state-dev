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

`observed-run.json` is a captured run, for a reader who cannot run it.

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

**2. The tool result is prose, not the declared structured output.** `sdk-tools.d.ts`
declares `FileWriteOutput` as `{ type: "create" | "update", filePath, content,
structuredPatch }`. What lands on the wire is the string `"File created successfully at:
…"`. So the authoritative record of *which file changed* is the tool **input**; the result
carries only success or failure. A design that reached for `structuredPatch` — or for
create-vs-update — would find nothing there.

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

**4. Todo ids are not positional.** The first captured run allocated `#1`/`#2`; the second
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
