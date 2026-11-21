---
title: Blocks
type: reference
description: "Every block field and the options of each kind, the order of the input and output checks, what a block may return, and where block state, sequencer state and targets live."
---

# Blocks

A block is one named piece of work with a declared input and output. You write the work, as code or as a model call. The framework checks the shapes on both sides, records what the block did, and decides what happens when it fails. A whole pipeline is a block too, so one set of rules covers a single tool and a full request.

There are five kinds. A handler runs your code. A generator asks a model to write. An evaluator asks a model a typed question. A sequencer runs blocks in order. A router picks one block to run. [Blocks](../concepts/blocks.md) builds the model. This page is the lookup.

The examples use a support desk. `handleTicket` is a sequencer that runs `cleanMessage`, a handler, then `pickReplier`, a router. `autoReply` and `escalate` are handlers in their own files beside them, shown first. Each takes `{ text, truncated }` and returns `{ reply }`.

```ts title="src/flows/support/blocks/auto-reply.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const autoReply = handler({
  name: "auto-reply",
  inputSchema: z.object({ text: z.string(), truncated: z.boolean() }),
  outputSchema: z.object({ reply: z.string() }),
  execute: (input) => ({ reply: `Thanks, we got: ${input.text.slice(0, 80)}` }),
});
```

```ts title="src/flows/support/blocks/escalate.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const escalate = handler({
  name: "escalate",
  inputSchema: z.object({ text: z.string(), truncated: z.boolean() }),
  outputSchema: z.object({ reply: z.string() }),
  execute: () => ({ reply: "This message was long, so a person will read it." }),
});
```

```ts title="src/flows/support/blocks/clean-message.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const cleanMessage = handler({
  name: "clean-message",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ text: z.string(), truncated: z.boolean() }),
  stateSchema: z.object({ trimmedChars: z.number().default(0) }),
  sequencerStateSchema: z.object({ cleaned: z.number().default(0) }),
  retry: { maxAttempts: 3, baseDelayMs: 200 },
  onErrored: (error) => console.warn("clean-message failed", error.message),
  execute: async (input, ctx) => {
    const text = input.message.trim();
    const kept = text.slice(0, 2000);
    await ctx.self?.incState({ trimmedChars: text.length - kept.length });
    await ctx.sequencer?.incState({ cleaned: 1 });
    return { text: kept, truncated: kept.length < text.length };
  },
});
```

```ts title="src/flows/support/blocks/pick-replier.ts"
import { router } from "@flow-state-dev/core";
import { z } from "zod";
import { autoReply } from "./auto-reply";
import { escalate } from "./escalate";

export const pickReplier = router({
  name: "pick-replier",
  inputSchema: z.object({ text: z.string(), truncated: z.boolean() }),
  outputSchema: z.object({ reply: z.string() }),
  routes: [autoReply, escalate],
  execute: (input) => (input.truncated ? escalate : autoReply),
});
```

```ts title="src/flows/support/blocks/handle-ticket.ts"
import { sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { cleanMessage } from "./clean-message";
import { pickReplier } from "./pick-replier";

export const handleTicket = sequencer({
  name: "handle-ticket",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ reply: z.string() }),
  stateSchema: z.object({ cleaned: z.number().default(0) }),
})
  .step(cleanMessage)
  .step(pickReplier);
```

Every name on this page comes from `@flow-state-dev/core` unless a row says otherwise. `ctx` is the context a block's `execute` receives.

## What a built block exposes

`handler()`, `generator()`, `evaluator()`, `router()` and `sequencer()` each return a `BlockDefinition`.

| Member | Type | What it holds |
|---|---|---|
| `kind` | `"handler" \| "generator" \| "evaluator" \| "sequencer" \| "router"` | One of the five. |
| `name` | `string` | The config's `name`. |
| `description` | `string \| undefined` | The config's `description`. |
| `transient` | `boolean` | `true` only when the config says `transient: true`. |
| `inputSchema`, `outputSchema` | Zod | The config's, or `z.any()` when left off. On a sequencer with steps, `inputSchema` is the declared one or else the first step's, and `outputSchema` reports the last step's. The sequencer's declared `outputSchema` is the one checked against its result. |
| `config` | the config | The config as built, with both schemas filled in. |
| `declaredResources`, `ownDeclaredResources` | map | Every resource the block and the blocks under it declare, and only the block's own. |
| `.connectInput`, `.connectOutput`, `.mapModelOutput`, `.rescue`, `.as`, `.asTool` | methods | Each returns a new block. See [Methods on a built block](#methods-on-a-built-block). |

A block has no public `run`. The framework runs it as an action, a step, a route or a tool, and `block.run(...)` is a type error in your code. To run one block on its own from a terminal, pass the file that default-exports it to `fsdev block`. The accepted file shape and the failure messages are on [CLI](./cli.md).

A block needs a non-empty `name`, or building throws `Cannot build "<kind>" block without a non-empty "name"`. Names are not checked for uniqueness across a flow or a sequencer. A router's `routes` and a single generator's tool list do check them.

## Fields every block takes

"Kinds" says where the framework reads the field. A field a kind's type accepts and the framework never reads is marked.

| Field | Type | Default | Kinds | What it does |
|---|---|---|---|---|
| `name` | `string` | required | all | The block's id in traces, items and DevTool. |
| `description` | `string` | none | all | A human description. |
| `inputSchema`, `outputSchema` | Zod | `z.any()` | handler, generator, evaluator, router; a sequencer takes both, see [Sequencer](#sequencer) | Left off, nothing is checked. A generator's default `outputSchema` is `z.string()`. An evaluator takes no `outputSchema`. |
| `stateSchema` | Zod object | none | all | The block's own state, read as `ctx.self`. See [Block state](#block-state). |
| `flowConfigSchema` | Zod | none | all | What the block requires of the flow copy's settings, and the type of `ctx.flow.config`. |
| `transient` | `boolean` | `false` | all | The block's own `block_trace` item and its `container` item stream live and are not kept in the request's items. Items the block emits with `ctx.emit.*` are not affected: each takes its own `{ transient }`. |
| `connectInput` | `(input, ctx) => nextInput` | none | handler, generator, evaluator, router | Runs before the input check, and `inputSchema` then checks its result. On a sequencer it is a method. |
| `activeStatusMessage` | `string` or `(input, ctx) => string` | none | all | Calls `ctx.emit.status(message)` when the block starts. A sequencer's function receives the sequencer's `ctx`. |
| `container` | `{ component?, label?, metadata? }` | none | **read only on sequencer and router** | Wraps the block's items in a `container` item. `label` and `metadata` may be functions of the input. A handler, generator or evaluator that sets it emits none. |
| `uses` | capability list; an entry may be `(ctx) => CapabilityRef[]` | none | all | Installs capabilities. |

These fields apply to some kinds only.

| Field | Type | Default | Kinds | What it does |
|---|---|---|---|---|
| `retry` | `RetryPolicy` | none | handler, generator, router | Applies when the block is the action's root block. A block used as a step, a route or a tool runs once whatever its `retry` says. To retry, give the root a policy, which reruns the whole root, sequencer included, or catch the failure with `rescue`. A sequencer takes no `retry` field, so a sequencer root's policy is the `retry` option of `runAction`. See [Errors](./errors.md#retry). |
| `rescue` | `RescueHandlerSpec[]` | none | handler, generator, evaluator, router | A recovery block. See [Errors](./errors.md#rescue). A sequencer uses the `.rescue()` method. |
| `cacheable` | `true` or `BlockCacheableConfig` | off | handler, generator, router | Caches the block's result when it is a tool. See [Tools](./tools.md#caching-a-tools-result). |
| `onCompleted`, `onErrored` | hooks | none | handler, generator, evaluator, router | See [Errors](./errors.md#oncompleted-and-onerrored). A sequencer has neither. |
| `resources` | map | none | handler, generator, evaluator, router | Resources the block declares. They reach the flow without being repeated there. Resources from capabilities in a sequencer's `uses` reach the flow. |
| `requestStateSchema`, `sessionStateSchema`, `userStateSchema`, `orgStateSchema` | Zod | none | handler, generator, evaluator, router | Type `ctx.request.state`, `ctx.session.state`, `ctx.user.state` and `ctx.org.state`. They type the handles. What is stored comes from the flow's own state schemas, and from [blocks that declare the same field](./flows.md#state-a-block-declares). |
| `sequencerStateSchema` | Zod object | none | handler, generator, evaluator, router | What the block expects of `ctx.sequencer`. Merged into the nearest sequencer's state when that sequencer is built. |
| `parentInputSchema` | Zod | none | handler and evaluator only | Types `ctx.parent.input`. It is not checked at run time. |
| `parentStateSchema` | Zod | none | handler, generator, evaluator, router | Types the parent's state operations on `ctx.parent`. Not checked at run time. |
| `targetStateSchemas` | map of name to Zod | none | handler, generator, evaluator, router | Types `ctx.targets.<name>`. Not checked at run time. |

## Required fields

| Kind | Required |
|---|---|
| handler | `name` (non-empty) and `execute`. Both schemas are optional. |
| generator | `name`, `prompt`, and `model` unless a capability in `uses` supplies one. |
| evaluator | `name`, `model`, `questions`. |
| sequencer | `name`. |
| router | `name`, `routes`, `execute`. |

A handler with no `execute` throws `Cannot build "<name>" (handler) without an execute function`. A generator with no model, on the block or from a capability, throws ``Generator "<name>" requires a model. Set one on the block or via a capability that contributes `model`.``

## Options per kind

### Handler

A handler is the kind that runs code. It accepts every field above.

| Field | Type | Default | What it does |
|---|---|---|---|
| `execute` | `(input, ctx) => output \| Promise<output>` | required | Called with the input after `connectInput` and the input check. The framework passes it `(input, ctx)` and nothing else. |

`handler.withDefaults({ sessionStateSchema, userStateSchema, orgStateSchema, requestStateSchema, sequencerStateSchema, resources, outputSchema, uses })` returns a handler constructor with those fields preset. A field passed to a call wins over the preset.

### Generator

[Generators](./generators.md) lists every generator option with its type and default, and the build-time refusals for an output schema. A generator needs a `prompt`, and a `model` unless a capability in `uses` supplies one. With no `outputSchema` it returns text, and its output schema is `z.string()`. It takes no `parentInputSchema`.

### Evaluator

An evaluator asks an evaluation model typed questions about one state and returns `{ answers }`.

| Field | Type | Default | What it does |
|---|---|---|---|
| `model` | a model string or an evaluation model instance | required | A string resolves at the first run through the app's model resolver's `resolveEvaluationModel` hook. An intent, an array, a `selectModel` function and a model from a capability are refused. |
| `questions` | map of id to `choice`, `score` or `boolean`, or `(input, ctx) => map` | required | The ids become the keys of `answers`. |
| `state` | `(input, ctx) => string \| array \| plain object` | the block's input | What the model reads. |

An evaluator also takes `onCompleted`, `onErrored`, `rescue`, `connectInput`, `resources`, `uses`, the scope state schemas, `parentInputSchema`, `parentStateSchema`, `targetStateSchemas`, `stateSchema` and `flowConfigSchema`, as a handler does. It takes no `outputSchema`, `retry` or `cacheable`.

Question builders:

| Builder | Takes | Refused when |
|---|---|---|
| `choice(instructions, options)` | a map of option key to description or `null` | there are no options |
| `score(instructions, levels)` | the levels | there are fewer than two |
| `boolean(instructions, criteria?)` | optional criteria | never |

Refusals at build or at the first run, with their exact messages, and how an evaluator's model string is resolved, are on [Models](./models.md). A run makes one provider call, with no retry and no fallback.

Each answer is typed by its question.

| Question | Answer |
|---|---|
| `choice` | `{ type: "choice", choice, probabilities?, confidence? }` |
| `score` | `{ type: "score", score, probabilities?, confidence? }`. `score` is a position from 0 to levels minus 1 and may be fractional. `probabilities` is keyed by level index. |
| `boolean` | `{ type: "boolean", probability, confidence? }`. `probability` is the model's estimate that the answer is yes, not its confidence. |

The output schema is a type only. Answers are not checked against it at run time.

`confidence` is on an answer only when the model reported one. Otherwise the key is absent, never a number the framework fills in. Which evaluation models report it is on [Models](./models.md). What `utility.cascadingRouter` does with an answer that has none is on [Utility blocks](./utility-blocks.md).

### Sequencer

`sequencer({ name, ... })` returns a builder. Steps are methods on it, listed on [Sequencer methods](./sequencer-methods.md), not config fields.

| Field | Type | Default | What it does |
|---|---|---|---|
| `name` | `string` | required | |
| `description` | `string` | none | |
| `inputSchema` | Zod | the first step's `inputSchema` when a first step is added; otherwise `z.any()` | |
| `outputSchema` | Zod | none | Checked against the returned value after the last step, on any exit (tail, `exitIf`, rescue). Failure throws `SequencerOutputSchemaError`. Left off, nothing is checked. |
| `stateSchema` | Zod object | none | Sequencer state: `ctx.sequencer`, and `ctx.self` in the sequencer's own callbacks. See [Sequencer state](#sequencer-state). |
| `uses` | capability list | none | |
| `durable` | `boolean` | `true` | Writes a checkpoint of the sequencer's state at each step boundary. See [Pause, resume and replay](./durable-execution.md#sequencer-checkpoints). |
| `transient` | `boolean` | `false` | As above. |
| `activeStatusMessage` | string or `(input, ctx) => string` | none | |
| `container` | object | none | Emits a `container` item around the sequencer's items. |
| `flowConfigSchema` | Zod | none | |

A sequencer takes no `retry`, `rescue`, `cacheable`, `onCompleted`, `onErrored` or `resources` field. `.rescue()` is a method.

What a checkpoint holds, when a write is skipped and how long checkpoints are kept are on [Pause, resume and replay](./durable-execution.md#sequencer-checkpoints). The failure of the `outputSchema` check is on [Errors](./errors.md#the-shapes-by-failure).

### Router

`router({ name, routes, execute, ... })` picks one block at run time and runs it with the router's own input. The selected block's output is the router's output, checked against the router's `outputSchema` if one is declared. All routes share the router's input and output types.

| Field | Type | Default | What it does |
|---|---|---|---|
| `routes` | `BlockDefinition[]` | required | The candidates. |
| `execute` | `(input, ctx) => BlockDefinition \| Promise<BlockDefinition>` | required | The selector. |
| `validateRoute` | `(candidate, routes, input, ctx) => boolean \| Promise<boolean>` | the membership check below | Replaces the membership check entirely. A `false` throws the same invalid-route error. |
| `container` | object | none | Honoured on routers. |

A router takes the shared fields and `parentStateSchema`, `targetStateSchemas`, `resources` and `uses`. It has no `parentInputSchema`.

#### What does a router do when no route matches?

There is no no-match case. `execute` must return a block. A returned block is accepted when it is the same object as one of `routes` or has the same `name` as one. Anything else fails the router with a plain `Error`:

```text
Router "pick-replier" selected invalid route "refund-bot". Route must be one of declared candidates.
```

`validateRoute`, when set, replaces this check. The error the client sees is on [Errors](./errors.md#router-target-and-sequencer-state-errors).

| Rule | Detail |
|---|---|
| Duplicate names | Two different blocks with one name in `routes` throw when the router is built: `Router "<name>" declares duplicate route name "<route>" across two different blocks. Route names must be unique so the recorded router decision is unambiguous on resume.` The same block listed twice is accepted. |
| Resume | The selector runs again on resume, and a different pick fails the resume. The rules for selectors are on [Pause, resume and replay](./durable-execution.md#routers). |

## The checks around `execute`

A handler, generator, evaluator or router runs these steps in order. A sequencer checks its own `outputSchema` after its last step.

| Step | What runs | Failure |
|---|---|---|
| 1 | `connectInput(rawInput, ctx)`, if declared | A throw is the block's failure. |
| 2 | `inputSchema` check on the connector's output | `Block "<name>" input validation failed at "<path>": <message>` |
| 3 | `execute(input, ctx)` | |
| 4 | `outputSchema` check on the return | `Block "<name>" output validation failed at "<path>": <message>` |
| 5 | `onCompleted(output, ctx[, meta])` | A throw fails the block, and `onErrored` then runs. |

- With a schema left off, nothing is checked: `z.any()` for handler, router and evaluator input and output, `z.string()` for a generator's output, and nothing for a sequencer's.
- `step(block)` takes a block whose input type is `any`, so TypeScript does not compare a step's input with the previous step's output. A mismatch fails at run time, at check 2.

A connector is `(input, ctx) => next | Promise<next>`. On a block it is `connectInput`. On a sequencer step it is the first argument, covered on [Sequencer methods](./sequencer-methods.md).

## Methods on a built block

| Method | What it does |
|---|---|
| `.connectInput(fn)` | Returns a block whose connector runs first. The original `inputSchema` checks the connector's output. |
| `.connectOutput(fn)` | Maps the block's result before it is returned. The returned block has `outputSchema: z.any()`, no `onCompleted` and no model-output mapper: the original `outputSchema` and `onCompleted` are dropped. |
| `.mapModelOutput(fn)` | Sets the string a model reads as a tool's result. See [Tools](./tools.md). |
| `.rescue(handlers)` | Replaces the block's rescue handlers. Available on every kind. On a sequencer it recovers the whole sequencer. |
| `.as({ name?, description? })` | A copy under a new name or description. A blank `name` is refused when the copy is built. |
| `.asTool(opts?)` | Wraps a block so a sequencer step emits a `tool_output`. `opts` takes `itemVisibility` and `agentName`. |

## Hooks, rescue, retry and tool caching

These fields are read on the block's config. Their rules are on the pages that own the behaviour.

| Field or method | Where |
|---|---|
| `onCompleted`, `onErrored` | [Errors](./errors.md#oncompleted-and-onerrored): when each fires and what a throw from it does. |
| `rescue`, `.rescue()` | [Errors](./errors.md#rescue): which handler runs, and how it orders against retry. |
| `retry` | [Errors](./errors.md#retry): fields, defaults, backoff and what is retried. |
| `onToolStarted`, `onToolCompleted`, `onToolErrored` | [Tools](./tools.md#tool-hooks): when each fires and the event shape. |
| `cacheable` | [Tools](./tools.md#caching-a-tools-result): config fields, cache key and stores. |

## What a block may return

| Kind | Returns |
|---|---|
| handler | The value `execute` returns, sync or async, checked against `outputSchema` if declared. A handler that exists for its side effect returns nothing and is chained with `.tap()`. |
| generator | Text when there is no `outputSchema`, the parsed object when there is one. |
| evaluator | `{ answers }`, typed by the questions. |
| sequencer | The last step's output, checked against `outputSchema` if declared. |
| router | The selected route's output, unchanged. |

Return what the next step needs, not everything the block read. Hand bulk data on through a sequencer `.map`, and store data a user needs to read later in a [resource](./resources.md).

A later step reads an earlier block's result with `ctx.getBlockOutput(block)`, `ctx.getBlockResult(block)` and `ctx.wasRescued(block)`. They are on [Sequencer methods](./sequencer-methods.md#reading-earlier-results).

## Block state

A block that declares a `stateSchema` has state of its own. A sequencer's `stateSchema` is block state too, addressed as `ctx.sequencer`.

| Handle | Points to | Declared with | `undefined` when |
|---|---|---|---|
| `ctx.self` | This block's own state | `stateSchema` on the block, or one a capability in `uses` contributes | The block and its capabilities declare no state. |
| `ctx.parent` | The immediate parent: `name`, `kind` and `input` always, plus its state operations when it has state | `parentStateSchema` (types only), and `parentInputSchema` for `.input` (handler and evaluator only) | The block is the outermost block of the run. The state operations are absent, not throwing, when the parent declares no `stateSchema`. |
| `ctx.sequencer` | The nearest enclosing sequencer that declares a `stateSchema`, including the block itself when it is that sequencer | `sequencerStateSchema` on the block, `stateSchema` on the sequencer | No enclosing sequencer has state. |
| `ctx.targets.<name>`, `ctx.getTarget<T>(name)` | A named block | `targetStateSchemas` (types only) | No block of that name is in scope. See [State targets](#state-targets-and-parents). |

A capability can contribute `stateSchema`, `sequencerStateSchema` and `targetStateSchemas`. It cannot declare `ctx.parent`: the capability preset has no `parentStateSchema` or `parentInputSchema`.

Two sources that contribute the same `ctx.self` field, two capabilities or a capability and the block's own `stateSchema`, must use the same schema object. Otherwise building throws `Own-state conflict (<where>): field "<key>" is declared by two sources with different schema references. Two contributors to the same ctx.self field must share the schema definition (reference one constant) or use distinct field names.` Both sides must be `z.object()`. Targets with one name and different schemas throw `Target conflict in capability "<cap>" (<source>): "<name>" is declared with different schema references`.

### The state reference

`ctx.self`, a `ctx.parent` with state, `ctx.sequencer` and each target are a `StateRef<TState>`: `name`, `instanceId`, `input` (the value the block was called with), `state` (read-only, and live when held in a variable across a write), and the operations `patchState`, `setState`, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord` and `atomicState`. [State operations](./state-operations.md) describes them.

`ctx.parent.input` for a step of the root sequencer, and for a route of a root router, is the run's input.

### Where does a block's own state live, and who can read it?

In memory, as a state instance for one execution of that block within one request. It starts from the block's `stateSchema` when the block starts and is dropped when it ends, so two requests never share it, and a block that runs twice gets fresh state each time. Its writes are applied one at a time and never raise `ConcurrentModificationError`. Session, user and org state are version-checked and can raise it.

- The block reads it as `ctx.self`.
- Its immediate children read it as `ctx.parent`, with the state operations present only when the block declared a `stateSchema`.
- A descendant, and a later block at the same level, read it by name with `ctx.targets.<name>` or `ctx.getTarget(name)`.
- For a sequencer, any block inside reads it as `ctx.sequencer`.
- A client sees it only as live `state_change` items. It does not read it back after the request.

A tool's own `ctx.self` is new on every call, because each call is a new scope started from the tool's `stateSchema`. A count kept there reads 1 every time. A tool is a child of the generator that calls it, so its `ctx.parent` is that generator. Writes to the generator's state through `ctx.parent` accumulate across the tool loop. The state operations are on `ctx.parent` only when the generator declares a `stateSchema`.

Where it starts and what loops and fan-out do to it are on [Sequencer methods](./sequencer-methods.md#state-inside-steps-loops-and-fan-out). Write ordering and the mutation timeout are on [State operations](./state-operations.md#transientslot). The `state_change` item is on [Items](./items.md). What a resume does to it is on [Pause, resume and replay](./durable-execution.md#sequencer-checkpoints). Where checkpoints and recorded outputs are stored is on [Stores](./stores.md).

### Sequencer state

In a sequencer's own callbacks, `ctx.sequencer.state` is typed from its `stateSchema`, and `ctx.self` is the same state.

| Rule | Detail |
|---|---|
| Child requirements merge in | A child's `sequencerStateSchema` is merged into the nearest sequencer that has a `stateSchema`, when that sequencer is built. It passes through a sequencer with no state, through a router's routes and through block-level rescue handlers. A field the sequencer lacks is added to its state. If the child's schema for that field does not accept `undefined`, the added field is made optional. A shared field must agree in kind. |
| From a capability | A capability's `sequencerStateSchema` is installed on the sequencer that uses it, and conflicts the same way. |
| Nesting | `ctx.sequencer` resolves to the nearest enclosing sequencer with state. A nested sequencer with no `stateSchema` is skipped. |

In the example, `cleanMessage` asks for `cleaned` through `sequencerStateSchema`, and `handleTicket` declares it. If `handleTicket` declared `cleaned` as a string, building throws `SequencerSchemaMismatchError`, see [Errors](./errors.md#router-target-and-sequencer-state-errors).

Fields marked `transientSlot(schema)` are left out of the checkpoint and reset on resume. See [State operations](./state-operations.md#transientslot).

### Declaring one field on two blocks

A block can declare session, user and org state fields. `defineFlow` merges every declaration of a scope and throws `ScopeStateSchemaConflictError` (imported from `@flow-state-dev/core/helpers`, not the package root) when two disagree on a field. A read fills in the merged schema's defaults. The merged schema does not check writes. What agrees, what is refused and the error's fields are on [Flows and actions](./flows.md#state-a-block-declares).

## State targets and parents

`targetStateSchemas: { <blockName>: schema }` types `ctx.targets.<blockName>` as `StateRef<...> | undefined`. The schema is not checked at run time, and `ctx.targets.<anyName>` resolves any name. The object cannot be enumerated: `Object.keys` is empty. `ctx.getTarget<T>(name)` is the same lookup with a name computed at run time.

| Rule | Detail |
|---|---|
| Resolution | Blocks already dispatched at the current level are searched first, most recent first, which is how a later step finds an earlier one. Then the ancestor chain. Not found returns `undefined`. |
| Sibling or ancestor | A sibling beats a same-named ancestor. |
| Ambiguity, and a target with no state | Both throw. The messages are on [Errors](./errors.md#router-target-and-sequencer-state-errors). |
| Names | Taken from the block's `name`, or a `.as()` copy's own. Names need not be unique. A repeat in the ancestor chain is what makes a lookup ambiguous. |
| Target state | In memory for the run of that block. Writes by a descendant stream as `state_change` items with `scope: "block_instance"`. |

Which handle for which job:

| Handle | Use it for |
|---|---|
| `ctx.sequencer` | State shared by the blocks of one sequencer |
| `ctx.targets.<name>` | A specific named ancestor, or an earlier sibling |
| `ctx.parent` | The immediate parent, whatever its kind or name |
