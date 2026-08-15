---
name: create-block
description: Create a block (handler, generator, sequencer, router) in an FSD project, wire it into a flow action, and verify it with the fsdev CLI. Use when adding a new step to an FSD flow, or when the user says "add a block", "make a generator", "write a handler".
---

You are adding a block to the user's own FSD project. You are NOT working in the framework
repository, and you must not look for one.

## Before you start: read the project's own ground truth

Read the **FSD section of `AGENTS.md`** at the project root. It is the source of truth for
this project's shape — the block kinds, how flows and actions are declared, what
capabilities are, where flows live, and which commands verify a change. **This skill does
not restate any of that**, deliberately: two copies of the same facts drift apart, and the
one written into the project is the one that matches the installed version.

If there is no FSD section in `AGENTS.md`, stop and tell the user to run `fsdev init`
first. Without it you would be guessing at the framework's shape from memory, which is the
exact failure this pack exists to prevent.

## Workflow

### 1. Pick the block kind

Decide from `AGENTS.md`'s list of kinds and the user's description. State which kind you
picked and why, in one line, before writing anything. If two kinds are defensible, say so
and pick the simpler one.

### 2. Find the shape from what is installed, not from memory

The authoritative signatures are in the project's own `node_modules/@flow-state-dev/core`
type declarations. Read the factory's type before you call it. Do not invent config keys.

### 3. Write the block

Put it beside the flow that uses it, under the flow directory `AGENTS.md` names. One file,
a file-header comment, and explicit input/output schemas.

### 4. Wire it into an action

A block reaches the outside world only through a flow action. Add it to the flow's action
chain, and keep the action's declared input the minimum the block needs.

### 5. Verify — this is not optional

Run the block on its own first, then the whole action:

```bash
npx fsdev block <block-name> --input '{ ... }'
npx fsdev run <flow> <action> --input '{"userId":"u1", ... }'
```

If the project has a test runner configured, add a test for the block's observable
behaviour too. A block you have not executed is a block you have not written — the CLI is
here so you can check your own output instead of asking the user to.

### 6. Report

Say what you added, which action reaches it, and paste the command you ran plus its
result. If a run failed and you fixed it, say what was wrong.

## Rules

- **Never edit files outside the project.**
- **Never invent an API.** If a symbol is not in the installed type declarations, it does
  not exist in the version this project has.
- **Prefer the smallest config surface** that does the job.
