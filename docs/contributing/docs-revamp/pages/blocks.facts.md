# Facts for blocks.md

Paths are from the repo root. `core` = `packages/core/src`; `hc` = `examples/hello-chat/src/flows/hello-chat/flow.ts`.

## What a block is
- A block has a name, a typed input schema and a typed output schema. | core/types/block.ts:1211-1217 (`kind`, `name`, `inputSchema`, `outputSchema`); BlockConfig core/types/block.ts:1055-1059
- Blocks can hold other blocks; sequencers and routers compose other blocks. | core/types/block.ts:38-43
- There are five kinds: handler, generator, evaluator, sequencer, router. | core/types/block.ts:43
- Handler runs code, generator asks a model to write, evaluator asks typed questions, sequencer and router compose. | core/types/block.ts:38-42
- A flow exposes actions a client can call. | hc:78-91 (`defineFlow` with `actions`); CLAUDE.md "Actions are flow-level: defineFlow({ actions })"

## The smallest flow (the code)
- `handler({ name, inputSchema, outputSchema, execute })`, `execute(input, ctx)` returns the output. | core/blocks/handler.ts:120-170; hc:58-66; core/types/block.ts:1076 (`execute`)
- `generator({ name, model, prompt, inputSchema, user, itemVisibility, tools })`; `user` is a function of input. | core/blocks/generator.ts:585 (`itemVisibility`), 599 (`model`), 612 (`user`), 613 (`tools`); hc:42-52
- `sequencer({ name, inputSchema }).step(block)` chains blocks; each step's output is the next step's input. | core/blocks/sequencer-methods.ts:163-166; hc:71-73
- `.step(connector, block)`: a function reshapes the previous output before the block. | core/blocks/sequencer-methods.ts:177-181
- `defineFlow({ kind, actions: { name: { block } } })` exposes a block as an action named `reply`; a client can call it. | hc:78-91
- A sequencer can be an action's block because a sequencer is a block (extends BlockDefinition). | core/blocks/sequencer-methods.ts:156-162; hc:82-83
- A generator with `itemVisibility` unset produces no auto-emitted items (model still streams, nothing shown to client). | core/blocks/generator.ts:1271-1275
- `itemVisibility: { client: true, history: true }` streams to the client and keeps the reply in history; `history: true` loads prior conversation. | core/blocks/generator.ts:585, 610; hc:42-52 (comments on history and visibility); old page apps/docs/docs/fundamentals/blocks.md:74-83 (table)
- A generator's default output is a string when `outputSchema` is omitted ("z.string() default"). | core/blocks/generator.ts:3391-3392; hc:35-38 (comment)
- Model id `openai/gpt-6-luna` is the docs convention. | docs/contributing/docs-revamp/WRITING-BRIEF.md "Words"

## The five kinds
- Evaluator: asks a model a question and gets a typed answer: a choice, a score, a yes or no. | core/blocks/evaluator.ts:3-8, 72, 86, 100
- Evaluators are for branching code on a model's answer. | core/blocks/evaluator.ts:3-8
- A handler shows the user nothing unless it emits through `ctx.emit`. | docs/architecture/blocks.md:65; `ctx.emit` at core/types/block.ts:466 (message, component, status)
- An item is one thing a flow streams to the client (message, tool call). | docs/architecture/items.md; core/types/block.ts:130 (`EmitMessageOptions`)
- A router "picks one block to run". | core/blocks/router.ts:160 (`router`), 255 (`kind: "router"`)

## Router
- `router({ name, inputSchema, outputSchema, routes, execute })`; `execute` returns a block (sync or async). | core/blocks/router.ts:132-141 (`routes`, `execute` types), 266-278
- Routes share the router's input and output types (`BlockDefinition<TInputSchema, TOutputSchema>[]`). | core/blocks/router.ts:134, 139-141
- Router is not in the example; the page says only that every route takes the router's input and returns its output, so a sequencer can treat it as one step. (Following line is the support.) A router is usable as a sequencer step (`.step(router)`). | old page apps/docs/docs/fundamentals/blocks.md:703 and core/blocks/sequencer-methods.ts:163 (`step(block)` takes any BlockDefinition)

## Tools
- A generator's `tools` accepts blocks (`GeneratorTool = BlockDefinition<any, any>`), any kind. | core/blocks/generator.ts:422, 613
- The model decides when to call a tool from its name and description; framework runs it and returns the result. | core/types/block.ts:1322-1330 (`.as` doc: "the model calls it by that name"); old page apps/docs/docs/fundamentals/blocks.md:122-152
- A sequencer can be a tool ("a whole pipeline behind one tool call"). | core/blocks/generator.ts:422 (any BlockDefinition); old page apps/docs/docs/fundamentals/blocks.md:124-152
- `description` is a block config field. | core/types/block.ts:1056

## State and resources
- A block declares its resources, and including the block in a flow installs them (block resources are merged into the flow's resources). | core/flow/defineFlow.ts:3-8, 1233-1290; core/blocks/sequencer.ts:1271-1276
- A resource is stored data a flow declares. | CLAUDE.md "Resources are declared on blocks, not wired per flow"; pilot tasks-and-boards.md:73

## What a block won't do
- A block has no call method in the public type (`BlockDefinition` omits `run`); the framework runs it. | core/types/block.ts:1195-1203
- A handler does not call other blocks in its `execute` (handlers only; routers return blocks, generators run tools, sequencers run steps); a handler needing another block's output goes after it in a sequencer. | docs/contributing/best-practices/blocks.md:9-18 (BP-011)

## Not verified against source, stated on the page
- Handler `description` is read by the model when the handler is a tool: stated via the `.as` doc (core/types/block.ts:1322-1330) and the old page (blocks.md:158), not through the tool-compile path.
- Example code type-checked by the coordinator.
- Resource example (`lookUpOrder` reading a stored list) is hypothetical and labelled "if".
