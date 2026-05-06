# Blocks

Blocks are the execution units in Flow State Dev. Every piece of logic — from a simple data transform to a multi-turn LLM conversation — is a block.

There are exactly four block kinds: **handler**, **generator**, **sequencer**, and **router**.

## Shared Contract

All blocks implement `BlockDefinition<TInput, TOutput>`:

```ts
interface BlockDefinition<TInput, TOutput> {
  kind: BlockKind;
  name: string;
  inputSchema?: ZodTypeAny;
  outputSchema?: ZodTypeAny;
  declaredResources?: DeclaredResources;

  run(input: TInput, ctx: BlockContext): Promise<TOutput>;
  connectInput<TFrom>(mapper: ConnectorFn<TFrom, TInput>): BlockDefinition<TFrom, TOutput>;
  connectOutput<TTo>(mapper: (output: TOutput, ctx: BlockContext) => TTo): BlockDefinition<TInput, TTo>;
}
```

**Execution rule:** All external execution paths must invoke blocks via `block.run(input, ctx)`. Never call `block.config.execute` directly — that's a framework internal.

## Block Context

Every block receives a `BlockContext` providing access to scopes, emission, and model resolution:

```ts
interface BlockContext {
  request: RequestScopeHandle;
  session?: SessionScopeHandle;
  user: UserScopeHandle;
  project?: ProjectScopeHandle;
  sequencer?: StateRef;

  response: ResponseEmitterHandle;
  signal: AbortSignal;
  resolveModel: ModelResolver;

  getTarget(name: string): StateRef | undefined;
  targets: Record<string, StateRef | undefined>;

  getBlockOutput(block: BlockDefinition): unknown | undefined;
  getBlockResult(block: BlockDefinition):
    | { status: "not_started" }
    | { status: "running" }
    | { status: "completed"; output: unknown }
    | { status: "failed"; error: Error };

  // Item emission
  emitMessage(text: string, options?: { agentType?: AgentType; agentName?: string }): void;
  emitComponent(component: string, data: Record<string, unknown>, options?: { key?: string; agentType?: AgentType; agentName?: string }): void;
  emitStatus(message: string, options?: { blocked?: boolean; backgroundTasks?: number }): void;
}
```

Each emitted item's visibility is derived from `(item.type, item.agentType)` via `resolveItemVisibility()`. Generators declare identity by setting `agentType` on their config; conversational items (message, reasoning, block_tool_output) inherit visibility from that identity, structural items have fixed per-type defaults. See the [item visibility](#item-visibility) section for the full model.

Blocks are **silent by default** — if a block doesn't explicitly emit via `ctx` methods, it produces nothing visible to the client or LLM.


`ctx.sequencer` resolves to the nearest enclosing sequencer in the execution stack. If that sequencer defines `stateSchema`, the returned `StateRef` is typed from the schema and exposes mutable instance state (`state`, `patchState`, `setState`, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord`, `atomicState`). Sequencer instance state initializes from `defaultState` when provided, otherwise from schema defaults (`safeParse(undefined)` / `safeParse({})`).

When no enclosing sequencer exists, `ctx.sequencer` is `undefined`.

`getTarget(name)` resolves nearest-first in two passes:
1. Already-dispatched siblings at the current execution level (most-recent dispatch wins)
2. Ancestor execution chain (parent-chain walk)

If multiple ancestors match and precedence cannot resolve, runtime throws `AmbiguousBlockNameError`.

### Sequencer state schema bubbling

Handler, generator, and router blocks can declare `sequencerStateSchema`. This follows the same bubbling contract as request/session/user/project schemas:

- block-level `sequencerStateSchema` declares what state shape a block requires
- when composed inside a sequencer, that schema bubbles up to the enclosing sequencer's instance-state contract
- sequencer-level `stateSchema` may be declared directly; when both are present they must be structurally compatible

```ts
const updateProgress = handler({
  name: "update-progress",
  sequencerStateSchema: z.object({ progress: z.number() }),
  execute: async (input, ctx) => {
    await ctx.sequencer?.patchState({ progress: input.progress });
  },
});

const research = sequencer({
  name: "research",
  stateSchema: z.object({ progress: z.number().default(0) }),
  defaultState: { progress: 0 },
}).then(updateProgress);
```

When sequencer state mutates, runtime emits a `state_change` item with `scope: "block_instance"` and the sequencer `blockInstanceId` in item provenance for client routing.

Tool blocks inherit the same context chain: if a tool runs inside a generator inside a sequencer, the tool's `ctx.sequencer` points to that nearest sequencer and `ctx.getTarget("<sequencer-name>")` resolves to the same handle.

For statically known target state coordination, handler/generator/router blocks can declare `targetStateSchemas` in config:

```ts
const validate = handler({
  name: "validate",
  targetStateSchemas: {
    research: z.object({ progress: z.number() })
  },
  execute: async (input, ctx) => {
    await ctx.targets.research?.patchState({ progress: 50 });

    // Dynamic fallback remains available
    const anyTarget = ctx.getTarget("research");
    return input;
  }
});
```

`ctx.targets.<name>` resolves with the same runtime lookup as `ctx.getTarget(name)` and is always `| undefined` to reflect topology-dependent availability at runtime.

### Block resource declarations

Blocks can declare their resource dependencies using `sessionResources`, `userResources`, and `projectResources` config properties. These accept `defineResource()` values and surface on `BlockDefinition.declaredResources`:

```ts
import { defineResource, handler } from "@flow-state-dev/core";

const planResource = defineResource({
  stateSchema: z.object({ steps: z.array(z.string()).default([]) }),
  writable: true,
});

const planManager = handler({
  name: "plan-manager",
  sessionResources: { plan: planResource },
  execute: async (input, ctx) => {
    await ctx.session.resources.plan.patchState({ steps: ["step1"] });
    return input;
  },
});

// planManager.declaredResources === { session: { plan: planResource } }
```

Resource declarations are supported on all block kinds: handler, generator, and router. Sequencers automatically collect declared resources from all child blocks in the DSL chain. `defineFlow` merges block-declared resources into the flow's scope configs — see [Resources and Client Data](./resources-and-client-data.md) for the full collection and merge model.

## Handler

The simplest block. Takes input, runs synchronous or async logic, returns output.

```ts
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const incrementCounter = handler({
  name: "increment-counter",
  inputSchema: z.string(),
  outputSchema: z.string(),
  sessionStateSchema: z.object({ messageCount: z.number().default(0) }),
  execute: async (input, ctx) => {
    const count = ctx.session.state.messageCount ?? 0;
    await ctx.session.patchState({ messageCount: count + 1 });
    return input;
  },
});
```

Key properties:
- `execute` is the user-provided logic
- `validateChunk` (optional) validates input chunks before execution
- `retry` (optional) configures retry policy
- Handlers emit `block_output` automatically (internal/devtools only)
- Use `ctx.emitMessage()` or `ctx.emitComponent()` for client-visible output

## Generator

Loop-capable block that wraps LLM calls. The framework manages the model invocation, tool loop, streaming, and output parsing.

```ts
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

const chatGenerator = generator({
  name: "chat-generator",
  model: "preset/fast",
  prompt: "You are a helpful, concise assistant.",
  inputSchema: z.object({ message: z.string().min(1) }),
  // Default outputSchema is z.string() — enables text streaming
  history: true,
  user: (input) => input.message,
  tools: [searchTool, calculatorTool],
  agentType: "primary",
});
```

### Generator Slots

Generators assemble model messages from four slots, resolved in order:

1. **`prompt`** — System instruction (string or function)
2. **`context`** — Additional context entries (via `contextFn()`, data)
3. **`history`** — Prior conversation messages
4. **`user`** — Current user input

Each slot can be a string, object, array, or async function `(input, ctx) => value`.

The `history` slot supports additional shorthands: `true` auto-fetches session history with defaults, and an options object (e.g. `{ limit: 8 }`) passes those options to `items.history()`. A function still works for full control.

#### Object-form `context` (XML tag aggregation)

`context` can be authored as an object whose keys become XML tag names in the rendered system message. When several sources (the generator's own config plus capabilities installed via `uses`) contribute to the same key, their values aggregate inside one tag rather than scattering across separate sections.

```ts
generator({
  prompt: "You are a research assistant.",
  context: {
    documents: [doc1, doc2],
    userPreferences: () => loadPrefs(),
    memory: {
      shortTerm: shortTermItems,
      longTerm: () => loadLongTerm(),
    },
    placeholder: null, // reserves order; omitted from output if nobody fills it
  },
  uses: [capA, capB], // both may contribute additional `documents` entries
});
```

Renders to one combined system message of the form:

```
You are a research assistant.

<documents>
  ...doc1...
  ...doc2...
  ...capA documents...
  ...capB documents...
</documents>
<user-preferences>
  ...
</user-preferences>
<memory>
  <short-term>...</short-term>
  <long-term>...</long-term>
</memory>
```

Rules:

- **Key normalization.** Keys may be authored as `camelCase`, `snake_case`, or `kebab-case` — all normalize to kebab-case before aggregation, so contributions to the same logical name from different sources collapse into one tag.
- **Value types.** String, string array, nested object (recursive), function returning any of those, and `null`/`undefined` (placeholder) are all permitted. Object values produce nested tags — wrap in `JSON.stringify(...)` if you want JSON content inside a tag.
- **Aggregation.** Same-key string contributions concatenate inside the tag in author order. Same-key nested-object contributions deep-merge. Mixing scalar and nested-object contributions on the same key throws.
- **Ordering.** Top-level tag positions follow first-insertion order across user config → static capability presets → dynamic capability resolvers. `null` placeholders reserve a slot up front for documentation-style ordering.
- **String leaves are escaped.** `<`, `>`, and `&` in user data are HTML-escaped so they aren't read by the model as tags. Nested-tag emission is unaffected.
- **Reserved tag names.** Names that collide with framework-emitted tags or model-conditioned protocol names (e.g., `tool_use`, `thinking`, `system`) error at render time. See `RESERVED_TAG_NAMES` in `@flow-state-dev/core/prompt`.

The original array form continues to work unchanged. String entries in an array slot still emit as their own additional system messages, in author order, after the combined prompt+tagged-context message.

### Tool Loop

- Generator owns the tool loop internally — bounded by `maxIterations` (or runtime default)
- Tools are authored as blocks (`handler`, `generator`, `sequencer`, `router`)
- Runtime compiles tool blocks into provider-native tool definitions internally
- Tool execution invokes `tool.run(args, ctx)`, not direct function calls

### Output Behavior

- **Text output** (default `z.string()` or no `outputSchema`): Streams via `content.delta` events, auto-emits `message` item
- **Structured output** (custom `outputSchema`): Uses `generate()` (no streaming), parsed and validated against schema
- **Repair**: `repair.mode` controls schema mismatch handling: `'auto'` (retry), `'rescue'` (route to rescue), `'fail'` (immediate)

### Automatic Emissions

Generators auto-emit items based on model output — but only when `agentType` is set:
- Reasoning/thinking → `reasoning` item
- Text response → `message` item (role: "assistant"), streamed via `content.delta`
- Tool invocation → `block_output` with `toolCall` (two-phase: in_progress → completed)
- Final return value → `block_output` (internal/devtools only)

To run a generator silently (no session items, only `block_output` via graph edges), omit `agentType`. See [Item Visibility](#item-visibility) for the identity model.

## Sequencer

Fluent DSL for composing blocks into pipelines. The sequencer is the primary composition primitive.

```ts
import { sequencer } from "@flow-state-dev/core";

const chatPipeline = sequencer({ name: "chat-pipeline", inputSchema: chatInputSchema })
  .then(chatGenerator)
  .then(incrementCounter);
```

### DSL Methods (20 total)

Each method produces a `BlockValue<T>` of a specific kind on the emitted
`block_output` item (FIX-413). Refs and structures avoid duplicating content
across the execution tree; see `docs/architecture/items.md` for the union
definition and resolution semantics.

| Method | Purpose | `block_output` kind |
|--------|---------|---------------------|
| `then(block)` | Execute block, pass output to next step | `ref` → child's item |
| `then(connector, block)` | Transform input before block execution | `ref` → child's item |
| `thenIf(condition, block)` | Conditional step execution | `ref` if taken, carries prior descriptor if skipped |
| `map(fn)` | Transform current value without a block | `inline` (novel content) |
| `parallel(steps)` | Execute named steps concurrently | `structure` (object of refs) |
| `forEach(block)` | Execute block for each array element | `structure` (array of refs) |
| `forEachBackground(block)` | Fire-and-forget fan-out per element | passthrough (value unchanged) |
| `doUntil(condition, block)` | Loop until condition is true | `ref` → final iteration's item |
| `doWhile(condition, block)` | Loop while condition is true | `ref` → final iteration's item |
| `loopBack(stepName, opts)` | Jump back to a named step (bounded) | passthrough |
| `work(block)` | Queue non-aborting side-chain execution | passthrough |
| `background(block)` | Alias for `.work()` | passthrough |
| `waitForWork(opts)` | Wait for queued work to complete | passthrough |
| `tap(block)` | Side effect without changing payload | passthrough |
| `tapIf(condition, block)` | Conditional side effect | passthrough |
| `rescue(handlers)` | Error recovery by error type | `ref` → rescue branch's item (when taken) |
| `branch(branches)` | Conditional multi-path execution | `ref` → selected branch's item |
| `thenAll(blocks)` | Run array of blocks concurrently, collect all results | `structure` (array of refs) |
| `thenAny(blocks)` | Try blocks sequentially, first success wins | `ref` → winning branch's item |
| `race(blocks)` | Run blocks concurrently, first success wins | `ref` → winning branch's item |
| `exitIf(condition)` | Conditional early exit from chain | passthrough |

"passthrough" means the op does not change the sequencer's running descriptor —
the last op that emitted `ref`, `inline`, or `structure` stays in effect.

Routers always emit `ref` to the selected route's item. Generators and
handlers always emit `inline` (they are leaves).

### Work Semantics

- `.work(block)` is **non-aborting** — failures don't stop the main chain
- `.waitForWork({ failOnError: true })` promotes work failures to terminal errors
- Use for background tasks like logging, analytics, or async notifications

### Inline Block Definitions

Steps support inline block creation:

```ts
pipeline
  .then(handler, {
    name: "validate",
    outputSchema: z.string(),
    execute: async (input, ctx) => { /* ... */ return input; }
  });
```

See [Sequencer DSL](./sequencer-dsl.md) for the full method reference.

## Router

Selects one block at runtime based on input or state.

```ts
import { router } from "@flow-state-dev/core";

const modeRouter = router({
  name: "mode-router",
  inputSchema: chatInputSchema,
  routes: [planSequencer, editSequencer, reviewSequencer],
  execute: async (input, ctx) => {
    const mode = ctx.session.state.mode;
    if (mode === "plan") return planSequencer;
    if (mode === "edit") return editSequencer;
    return reviewSequencer;
  },
});
```

- `routes` declares candidate blocks (used for type checking and devtools)
- `execute` returns the selected block definition
- The selected block is executed with the router's input via `selected.run(input, ctx)`

## Connections

All blocks support input/output transformation:

```ts
// Transform input before a block
const adapted = myBlock.connectInput((rawInput, ctx) => ({ message: rawInput.text }));

// Transform output after a block
const mapped = myBlock.connectOutput((output, ctx) => output.summary);
```

Sequencer step-level connectors are preferred over `connectInput` for better type inference:

```ts
pipeline.then((output, ctx) => ({ query: output.text }), searchBlock);
```

## Block Naming

- Names are **flow-scoped**, not globally unique
- Duplicate names within a flow are allowed
- Name resolution uses cascading precedence (inner to outer execution stack)
- Ambiguous same-precedence collisions raise `AmbiguousBlockNameError`
- Runtime identity uses `blockInstanceId`, not `name`

## Item Visibility

Visibility is a pure function of `(item.type, item.agentType)` computed by `resolveItemVisibility()`. There are no per-item `client` / `history` overrides — identity is the lever.

### Generator identity (`agentType`)

Every generator declares one of four stances:

| `agentType` | Client stream | LLM history | DevTool |
|-------------|:-------------:|:-----------:|:-------:|
| `"primary"` | ✓ | ✓ | ✓ |
| `"sub"`     | ✓ | — | ✓ |
| `"trace"`   | — | — | ✓ |
| *unset*     | *no auto-emission* — only `block_output` flows via graph edges |

No position-inferred default. Every generator declares its own identity.

```ts
const researcher = generator({
  name: "researcher",
  agentType: "sub",           // visible to the user for observability,
  agentName: "researcher",    // not inherited by the orchestrator's history.
  prompt: "Analyze and summarize.",
  model: "anthropic:claude-sonnet-4-6",
});
```

Structural item types (`component`, `status`, `container`, `source`, `state_change`, `resource_change`, `error`, `block_output`, `router_decision`, `state_snapshot`, `block_debug`) have fixed per-type visibility. `agentType` on a structural item is metadata for filtering / rendering, not visibility — except `"trace"`, which always forces `{ client: false, history: false }` regardless of type.

### `agentName`

Stable name stamped on every emitted item. Defaults to the block's `name`. Generators that share an `agentName` represent one logical agent (collaborative parallel work); distinct names stay isolated.

### Emission helpers

- `ctx.emitMessage(text | content[], options?)` — the primary way to emit assistant-visible content. Accepts optional `{ key?, agentType?, agentName? }`. Without identity, a handler-emitted message defaults to agent-equivalent visibility (on client, in history).
- `ctx.emitComponent(component, data, options?)` — UI components. Accepts optional `{ key?, agentType?, agentName? }`.
- `ctx.emitStatus(message, options?)` — transient progress indicators. Structural; identity does not affect visibility.

Examples:

```ts
ctx.emitMessage("Analysis complete.");
// Agent-equivalent visibility (client + history).

ctx.emitMessage("Debug: classifier chose route A", { agentType: "trace", agentName: "classifier" });
// Devtool-only observation — hidden from user and LLM.

ctx.emitMessage("Background audit complete.", { agentType: "sub", agentName: "auditor" });
// Visible live but excluded from conversation history.
```

## Canonical Authority

For full type signatures, edge cases, and detailed semantics, see `../preperation/architecture/BLOCKS.md`.


Output dependencies use block-definition references instead of name-based state handles:

```ts
const result = ctx.getBlockResult(validateBlock);
const output = ctx.getBlockOutput(validateBlock);
```

These APIs resolve only against already-dispatched siblings at the current execution level. They do not walk the ancestor chain.


`BlockContext.request` also exposes live `tokenUsage` and `costEstimate` rollups. `tokenUsage` is aggregated by model from emitted generator `block_output.modelUsage`. `costEstimate` is computed when a flow `costEstimator` is configured.

