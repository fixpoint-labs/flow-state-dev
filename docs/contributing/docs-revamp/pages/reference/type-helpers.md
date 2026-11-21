---
title: Type helpers
type: reference
description: "Every exported type helper: what it extracts, from what, and which package it imports from."
---

# Type helpers

A type helper is a TypeScript type that reads another type out of something you have already defined. Flow State is built from schemas: a block declares its input and output as Zod schemas, a flow declares its actions, a resource declares its state. The helpers let you name what those schemas produce, such as an action's input on the client or a resource's state in a helper function, without writing the shape a second time. When the schema changes, the helper's result changes with it.

Every helper is a type. It exists at compile time and adds nothing to a bundle. This page lists each one with what it resolves to, what you pass it, and where it imports from.

The examples use a support desk: a `support` flow with a `reply` action that runs the block `draftReply`.

```ts title="src/flows/support/blocks/draft-reply.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const draftReply = handler({
  name: "draft-reply",
  inputSchema: z.object({
    ticketId: z.string(),
    tone: z.enum(["formal", "friendly"]).default("friendly"),
  }),
  outputSchema: z.object({ reply: z.string() }),
  execute: async (input) => ({ reply: `Replying to ${input.ticketId}` }),
});
```

The flow registers that block as its `reply` action.

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { draftReply } from "./blocks/draft-reply";

export const supportFlow = defineFlow({
  kind: "support",
  actions: { reply: draftReply },
});
```

## Quick answers

| Question | Answer |
|---|---|
| How do you get an action's input type on the client? | `ActionInputOf<typeof supportFlow, "reply">` from `@flow-state-dev/client`. See [On the client](#on-the-client). |
| How do you get a block's input or output type? | `BlockInput<typeof draftReply>` and `BlockOutput<typeof draftReply>` from `@flow-state-dev/core`. |
| Which helpers are not on the `@flow-state-dev/core` root? | `FlowActionInput`, `FlowActionBlock`, `InferFlowStateMap`, `InferFlowBlockContext`, `InferScopeStateFromConfig`, `SchemaInput` and `SchemaOutput` come from `@flow-state-dev/core/types`. |
| What type should a shared helper's `ctx` parameter have? | Plain `BlockContext` from `@flow-state-dev/core`. Every block's `ctx` is assignable to it, with no cast. See [Block definitions and context](#block-definitions-and-context). |
| What does a state write like `patchState` return? | A `Promise<boolean>`: `true` when state changed, `false` when the new value equals the current one. See [Scope handles](#scope-handles). |
| What does a client call do when you misspell an action name? | With `.flow<typeof supportFlow>(...)` it is a compile error; with `.flow(...)` and no type argument it is not. See [On the client](#on-the-client). |
| What does `ClientDataOf` change at runtime? | Nothing. Client data stays `JsonValue`; the type is a compile-time label. |
| What does a helper give for something it cannot read? | `never` for most, not a compile error. A row that gives `unknown` or a record type says so. |

## A block's input and output

Import from `@flow-state-dev/core`.

| Helper | Resolves to | Pass it |
|---|---|---|
| `BlockInput<T>` | The output side of `T.inputSchema`. `never` when `T` has no `inputSchema`. | A block, `typeof draftReply`. |
| `BlockOutput<T>` | The output side of `T.outputSchema`. `never` when `T` has no `outputSchema`. | A block. |

Both read the output side of the schema, so a field with a default is present and not optional. For `draftReply`:

```ts title="src/lib/reply-types.ts"
import type { BlockInput, BlockOutput } from "@flow-state-dev/core";
import type { draftReply } from "../flows/support/blocks/draft-reply";

type DraftInput = BlockInput<typeof draftReply>;
// { ticketId: string; tone: "formal" | "friendly" }

type DraftOutput = BlockOutput<typeof draftReply>;
// { reply: string }
```

Neither is constrained to a block. Any object with the schema property works, and one without it gives `never`.

An evaluator block's `answers` and a faceted collection's search input are typed through these two. See [Blocks](./blocks.md).

## Block definitions and context

Import from `@flow-state-dev/core`.

| Helper | What it is |
|---|---|
| `BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput>` | What the block factories return, the type of `typeof draftReply`. Parameters and defaults: [Blocks](./blocks.md). |
| `BlockKind` | `"handler" \| "generator" \| "evaluator" \| "sequencer" \| "router"`, the type of `block.kind`. |
| `BlockContext<...>` | The type of `ctx` inside `execute`. The state, resources and targets parameters default to open records or maps, so a typed `ctx` from any block is assignable to plain `BlockContext`, whatever state, resources, targets or capabilities the block declared. Parameters and defaults: [Blocks](./blocks.md). |
| `BlockResult<TOutput>` | The result of running a block, a union on `status`. Its four values: [Blocks](./blocks.md). |

A helper that several blocks call with their own `ctx` takes the plain type. No cast is needed:

```ts title="src/lib/log-ticket.ts"
import type { BlockContext } from "@flow-state-dev/core";

export function logTicket(ctx: BlockContext, ticketId: string) {
  // Accepts the ctx of any block, whatever state or resources it declares.
}
```

## State and context types

Import from `@flow-state-dev/core`.

| Helper | Resolves to | Pass it |
|---|---|---|
| `StateOf<T>` | The output side of `T.stateSchema` when `T` has one. When `T` is itself a Zod schema, its output side. Otherwise `never`. | A resource, a resource collection, a scope config, or a Zod schema. |
| `ContextOf<T, Kind>` | The handle for `Kind`, over `StateOf<T>`. `"resource"` (the default) gives `ResourceContext`, `"session"` gives `SessionScopeHandle`, `"request"` gives `RequestScopeHandle`, `"user"` gives `UserScopeHandle`, `"org"` gives `OrgScopeHandle`. The state falls back to `JsonObject` when `StateOf<T>` is not an object. | The same, plus a kind string. |
| `ResourceContext<TState>` | The handle behind `ctx.resources.<name>`. Its members: [Resources](./resources.md). | A state type that extends `JsonObject`. |
| `ClientDataOf<T>` | What a resource shows the client. `Pick` of the state for `client.expose`, `Omit` for `client.exclude`, the awaited return type of `client.data`, otherwise the whole state. `never` for anything that is not a defined resource or collection. | A resource or collection, `typeof artifacts`. |

How a resource shows its state to the client: [Resources](./resources.md).

Three of React's resource hooks, `useResourceCollection`, `useResourceCollectionList` and `useCollectionResource` (the one-item hook), take the projection as a type parameter. Without it, `clientData` is `unknown`. `useResource` takes the resource definition as an argument and types `clientData` from it. For a `tickets` collection declared with `client: { expose: ["title"] }`:

```ts title="src/flows/support/resources/tickets.ts"
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

export const tickets = defineResourceCollection({
  pattern: "tickets/**",
  scope: "session",
  stateSchema: z.object({ title: z.string(), secret: z.string() }),
  client: { expose: ["title"] },
});
```

```tsx title="src/app/ticket-title.tsx"
import type { ClientDataOf } from "@flow-state-dev/core";
import { useCollectionResource, type SessionView } from "@flow-state-dev/react";
import type { tickets } from "../flows/support/resources/tickets";

export function TicketTitle({ session, id }: { session: SessionView; id: string }) {
  const { item } = useCollectionResource<ClientDataOf<typeof tickets>>(session, "tickets", id);
  return <span>{item?.clientData?.title}</span>; // clientData is { title: string }
}
```

Reading `item.clientData.secret`, which was not exposed, is a compile error. `ClientDataOf` is compile-time only: the runtime payload stays `JsonValue`.

### Scope handles

Each takes a `TState` that defaults to `Record<string, unknown>`. Import from `@flow-state-dev/core`. The members of each handle, and what every state write returns, are on [State operations](./state-operations.md).

| Helper | What it is |
|---|---|
| `SessionScopeHandle<TState>` | The handle for the session scope. |
| `UserScopeHandle<TState>` | The handle for the user scope. |
| `OrgScopeHandle<TState>` | The handle for the org scope. |
| `RequestScopeHandle<TState>` | The handle for the request scope. |
| `ScopeStateOps<TState>` | The state write methods every handle carries: `patchState` (as `patchState(updates)` and `patchState(key, updater)`), `setState`, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord` and `atomicState`. Each returns `Promise<boolean>`: `true` when the write changed state, `false` when the new value is structurally equal to the current one. On `false` the write and its `state_change` event are skipped, so `ctx.session.patchState({ status: "open" })` on a session already `"open"` resolves `false`. |

## An action's types

Import from the package in the last column.

| Helper | Resolves to | Pass it | Import from |
|---|---|---|---|
| `FlowActionInput<TAction>` | The input type of the action's block: `TAction["block"]["inputSchema"]["_output"]`. | One action, `typeof supportFlow.actions.reply`. | `@flow-state-dev/core/types` |
| `FlowActionBlock<TAction>` | The block the action runs. | The same. | `@flow-state-dev/core/types` |
| `ActionNameOf<TFlow>` | The flow's action names: `keyof TFlow["actions"] & string`. `string` for `UntypedFlow`. | `typeof supportFlow`. | `@flow-state-dev/client` |
| `ActionInputOf<TFlow, TAction>` | `FlowActionInput` of the named action. `unknown` for `UntypedFlow`, `never` when `TAction` is not an action of the flow. | `typeof supportFlow` and an action name. | `@flow-state-dev/client` |
| `TypedFlow` | `{ actions: Record<string, ActionConfig> }`, the constraint a flow type meets. | | `@flow-state-dev/client` |
| `UntypedFlow` | `{ actions: Record<string, never> }`, the flow type `client.flow(address)` has when you give none: any action name, input `unknown`. | | `@flow-state-dev/client` |

`ActionConfig`, `ActionEntry` and `NormalizedActions` import from `@flow-state-dev/core`. What each is, and how an action is typed from its block: [Flows](./flows.md).

### On the client

`ActionInputOf<typeof supportFlow, "reply">` is the input of the `reply` action. Import the flow as a type only, so no server code reaches the browser bundle.

```ts title="src/lib/support-client.ts"
import { createClient, type ActionInputOf } from "@flow-state-dev/client";
import type { supportFlow } from "../flows/support/flow";

export type ReplyInput = ActionInputOf<typeof supportFlow, "reply">;

export function sendReply(userId: string, input: ReplyInput) {
  return createClient({ userId, baseUrl: "" })
    .flow<typeof supportFlow>("support")
    .send("reply", input);
}
```

`client.flow<typeof supportFlow>("support")` returns a handle whose `send` takes `ActionNameOf<typeof supportFlow>` as the action and `ActionInputOf` of that action as the input. `.send("replly", input)` and `.send("reply", { ticket: "t-1" })` are both compile errors. `client.flow("support")` with no type argument is `UntypedFlow`: any action name is accepted and the input is `unknown`, so neither mistake is caught. More on the handle: [Client configuration](./client.md). Reaching one member of a collection flow is on [Flows](./flows.md).

On the server, `FlowActionInput<typeof supportFlow.actions.reply>` from `@flow-state-dev/core/types` gives the same type.

## A flow's declared state and config

| Helper | Resolves to | Pass it | Import from |
|---|---|---|---|
| `InferScopeStateFromConfig<TScopeConfig>` | The output side of the scope's `stateSchema`. `Record<string, never>` when it has none. | A scope config. | `@flow-state-dev/core/types` |
| `InferFlowStateMap<TDefinition>` | `{ request, session, user, org }`, each from `InferScopeStateFromConfig` of that scope. | A flow definition. | `@flow-state-dev/core/types` |
| `InferFlowBlockContext<TDefinition>` | `BlockContext` with the request, session, user and org state types from `InferFlowStateMap`. | A flow definition. | `@flow-state-dev/core/types` |
| `FlowConfigInput<TConfigSchema>` | The input side of a flow's `configSchema`. | A `configSchema` or `undefined`. | `@flow-state-dev/core` |
| `FlowConfigValue<TConfigSchema>` | The output side, read-only. | The same. | `@flow-state-dev/core` |
| `InferFlowConfigFromSchema<TSchema>` | What a block reads as `ctx.flow.config`. | A block's `flowConfigSchema`. | `@flow-state-dev/core` |

Defaults, the no-schema cases and `requiresConfig`: [Flows](./flows.md).

### Flow types and flow instances

`defineFlow(...)` returns a `FlowType`, which you call to get a `FlowInstance`. Both import from `@flow-state-dev/core`. What each carries, and how `id`, `config` and `cardinality` differ between them: [Flows](./flows.md).

## Views and evaluators

| Helper | Resolves to | Pass it | Import from |
|---|---|---|---|
| `ViewOutput<TView>` | `BlockOutput<TView["block"]>`, what the view answers. | A view definition. | `@flow-state-dev/core` |
| `ViewInput<TView>` | `BlockInput<TView["block"]>`. | The same. | `@flow-state-dev/core` |
| `ViewElement<TBlock>` | The element type of a block whose output is a list, else `never`. It types a keyed view's `key(entry)`. | A block. | `@flow-state-dev/core` |
| `ViewValueOf<TRef>` | `ViewOutput<TView>` for a `ViewRef<TView>`, else `unknown`. | A `ViewRef`, made by `viewRef<TView>(flow, view)`. | `@flow-state-dev/client` |
| `ViewInputOf<TRef>` | `ViewInput<TView>` for a `ViewRef<TView>`, else `unknown`. | The same. | `@flow-state-dev/client` |
| `FacetsOf<TEvaluator>` | The `answers` of an evaluator's output, which is what a [faceted collection](../build/find-by-facets.md) stores. `never` when the output has no `answers`. | An evaluator block. | `@flow-state-dev/core` |
| `EvaluatorAnswers<TQuestions>` | A map from each question id to that question's answer type. | The `questions` object. | `@flow-state-dev/core` |

What a view's block must declare, and how a keyed view uses `ViewElement`: [Views](./views.md).

## Composition, capabilities and kits

Import all of these from `@flow-state-dev/core`, except `SchemaInput` and `SchemaOutput`.

| Helper | Resolves to | Pass it |
|---|---|---|
| `ParallelStepOutput<TStep>` | The output type of one step in a sequencer's `.parallel({...})`. What each step contributes: [Sequencer methods](./sequencer-methods.md). | One parallel step. |
| `FactoryConfig<TFactory>` | The parameter type of a block factory function. | `typeof createDraftReply`. |
| `InferCapabilities<TUses>` | The helper namespaces `ctx.cap` carries, from the capabilities in a `uses` array. | A `uses` tuple. |
| `ConfigArgOf<Self>` | The argument of a capability's `.config()` call. | A defined capability. |
| `SlotValue<S>` | What a kit's `install` receives for a slot. Its shape per slot kind: [Kits and slots](./kits.md). | A slot declaration. |
| `SchemaInput<T>` and `SchemaOutput<T>` | `T["_input"]` and `T["_output"]` of a Zod type. `never` for anything else. Import from `@flow-state-dev/core/types`. | A Zod schema. |

### What `uses` reflects into `ctx`

A block's `ctx` is typed from the capabilities listed directly in its `uses`, from their top-level fields. `InferCapabilities` gives only the `ctx.cap` entry; the block's own types pick up the others without a helper.

| Capability field | Appears as |
|---|---|
| `sessionStateSchema` | `ctx.session.state` |
| `resources` | `ctx.resources.<key>` |
| `targetStateSchemas` | `ctx.targets.<key>` |
| `sequencerStateSchema` | `ctx.sequencer.state` |
| `stateSchema` | `ctx.self.state` |
| `fns` | `ctx.cap.<name>` |

The type-only fields `sessionStateType`, `resourcesType`, `targetStatesType`, `sequencerStateType` and `stateSchemaType` override the type their matching field gives. They carry no runtime value, and setting one without its schema or map is a compile error. They survive `.presets()`, `.config()` and either chain. The `ctx.cap` namespace is the intersection over the listed capabilities, keyed by `name`.

Limits:

- A schema supplied only through a preset or a config resolver merges at runtime and adds nothing to the types. Declare it at the capability's top level to type it.
- Request, user and org state are never reflected.
- A dependency's schemas install at runtime, including its `fns`, and contribute nothing to the block's types. Redeclare them on the outer capability to type them.
- A dynamic entry contributes nothing: `InferCapabilities` of a dynamic-only list is `{}`.
- A capability with no `fns` types as `Record<string, never>` at `ctx.cap.<name>`, but at runtime no such key exists and reading it gives `undefined`.
- A sequencer's `ctx` is not typed from its `uses`. Handler, generator, router and evaluator are.

Everything else about capabilities, including what `.config()` refuses: [Capabilities](./capabilities.md).

## In React

Import from `@flow-state-dev/react`.

| Helper | Resolves to | Pass it |
|---|---|---|
| `ClientDataValues<TOptions>` | The value `useClientData(session, options)` returns, with a key for each scope the options name. The shape per option form: [Client configuration](./client.md). | The `options` object. |

```tsx title="src/app/ticket-mode.tsx"
import { useClientData, type SessionView } from "@flow-state-dev/react";
import { z } from "zod";

const modeSchema = z.enum(["triage", "reply"]);

export function useTicketMode(session: SessionView) {
  const data = useClientData(session, { session: { mode: modeSchema } });
  return data.session.mode; // "triage" | "reply"
}
```

## Next

- [Flows reference](./flows.md): the options `defineFlow` takes and the properties above.
- [Client configuration](./client.md): `createClient` and `FlowProvider`.
- [Blocks reference](./blocks.md): the schemas these helpers read.
