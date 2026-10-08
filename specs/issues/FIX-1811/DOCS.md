# FIX-1811 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Three operations, all extensions of existing pages. No new page: `.as()` is one method beside
`.asTool()` and `.mapModelOutput()`, and it belongs where readers already learn that any block
can be a tool. Voice rules most at risk here: no "X isn't just Y" framing when contrasting `.as()`
with `.asTool()`, and say what a tool name is for on first use.

## UPDATE · `apps/docs/docs/fundamentals/blocks.md` · new subsection after "Any block can be a tool", before "Showing a deterministic call as a tool: `.asTool()`"

#### Renaming a block for the model: `.as()`

The model calls a tool by the block's `name` and decides when to call it from the block's
`description`. A block you didn't write, from a pattern or another package, often has a name
that reads wrong in your flow, or no description at all.

`block.as({ name, description })` returns a copy of the block under a new name, a new
description, or both. Everything else is the same block: its schemas, connectors, resources and
rescue handlers come along.

```ts
import { generator } from "@flow-state-dev/core";
import { notes } from "./notes";

const assistant = generator({
  name: "assistant",
  model: "openai/gpt-5.4-mini",
  tools: [
    notes.write.as({
      name: "saveNote",
      description: "Save a note for the person. Use it when they ask you to remember something.",
    }),
  ],
});
```

The new name is the copy's name everywhere, not only in what the model is offered. Tool pills,
traces and a suspended call's resume all use `saveNote`. The original `notes.write` keeps its
own name wherever you use it directly, so nothing recorded under it changes.

Leave out `name` to keep it and only replace the description, or leave out `description` to
keep the original's. A blank name is refused when the copy is built. Two copies of one block
under two names are two tools; two blocks with the same name in one `tools` array are refused,
as they always are.

`.as()` returns a plain block, so on a sequencer finish adding steps first and rename last.

`.as()` is not `.asTool()`. `.as()` changes what the block is called and adds nothing at run
time. `.asTool()`, below, wraps a block so a sequencer step shows a tool pill. They stack: put
`.as()` first, and the pill shows the new name.

```ts
fetchPrices: getPrices.as({ name: "fetchPrices" }).asTool({ agentName: "analyst" }),
```

The other order, `.asTool().as(...)`, renames only the wrapper's row in the trace, and the pill
keeps the original name.

## UPDATE · `packages/core/README.md` · "Block methods" list, after `.mapModelOutput(mapper)`

- `.as({ name?, description? })` — a copy of the block under a new name and/or description, for showing it to a model as a tool or registering it under a key that must match its name. The new name is used everywhere (tool calls, items, traces, resume); the original is unchanged. Adds nothing at run time, unlike `.asTool()`

## UPDATE · `apps/docs/docs/workforce/built-in-worker.md` · after "The key has to match the tool's own name; a catalog key that doesn't is refused when the kind is built:"

> To list a block under a different key, rename the block to match with
> [`.as({ name })`](../fundamentals/blocks.md#renaming-a-block-for-the-model-as). The catalog
> doesn't rename it for you, so a mistyped key is still caught.

## Publication ownership

FIX-1811 publishes all three after V6 confirms the catalog behavior. Rewriting the pages and
examples that teach today's wrapper (`workforce/chief-of-staff.md`, `workforce/projects.md`, the
Workforce README) is FIX-1812's, with the code sites, so the two PRs don't edit one page; they
link to the section added here.
