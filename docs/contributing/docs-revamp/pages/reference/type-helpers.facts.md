# Facts for Type helpers (R-38, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests and `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit text. **[source]** marks a fact read from the type definition itself with no test or doc comment pinning it; **[test]** a compile-time test (`*.test-d.ts`) or vitest file pins it; **[doc]** an existing user doc states it and the code agrees. Nothing was run against a deployed server. No throwaway type probe was run this session, so every "resolves to" below is read from the definition and, where one exists, from a `.test-d.ts` assertion.

Paths are from the repo root. Abbreviations:

- Core, `packages/core/src/`: `blk` = `types/block.ts`, `res` = `types/resource.ts`, `ft` = `types/flow.ts`, `sc` = `types/scope.ts`, `st` = `types/state.ts`, `vw` = `types/view.ts`, `fac` = `types/faceted-collection.ts`, `evt` = `types/evaluation.ts`, `sm` = `blocks/sequencer-methods.ts`, `cap` = `capability/types.ts`, `kit` = `kit/define-kit.ts`, `sch` = `schema/common.ts`, `cp` = `helpers/client-projection.ts`, `idx` = `index.ts`, `tidx` = `types/index.ts`, `df` = `flow/defineFlow.ts`
- Client, `packages/client/src/`: `cl` = `client.ts`, `cv` = `view/view.ts`, `cidx` = `index.ts`
- React, `packages/react/src/`: `ucd` = `hooks/useClientData.ts`, `ridx` = `index.ts`
- Tests: `aet` = `packages/core/test/action-entry.test-d.ts`, `fct` = `packages/core/test/faceted-collection.test-d.ts`, `evat` = `packages/core/test/evaluator-answers.test-d.ts`, `bca` = `packages/core/test/block-context-assignability.test-d.ts`, `pct` = `packages/core/test/projected-resource-collection.test.ts`, `fcf` = `packages/core/test/flow-config.test.ts`, `clt` = `packages/client/test/client.test.ts`, `rvt` = `packages/workforce/test/roster-view-types.test-d.ts`
- Existing user docs: `ts-doc` = `apps/docs/docs/fundamentals/type-system.md`, `core-rd` = `packages/core/README.md`, `cl-rd` = `packages/client/README.md`, `re-rd` = `packages/react/README.md`

## 0. What the page is, and what it stores

A Reference page: tables and lookups, no narrative, no word budget. The plan names one table (each helper type: what it extracts, and from what) and one lookup: "How do you get an action's input type on the client?" Answer in section 3.

The page's job is a helper type's name, its type parameters, what it resolves to and from what, and the package and path it imports from. Every helper below is `export type`: it exists at compile time only and adds nothing to a bundle.

**The four storage questions do not apply.** A type helper stores nothing, so there is no owner, viewer, storage location or count to state. The one thing that has an owner is the value the type describes, and each section names the page that covers it.

**Where each helper imports from.** The page's table needs an import column. The five packages are separate and the helpers do not all share one path:

- `@flow-state-dev/core` root (`idx`): `BlockInput`, `BlockOutput`, `BlockDefinition`, `BlockKind`, `BlockContext`, `BlockResult`, `StateOf`, `ContextOf`, `ResourceContext`, `ClientDataOf`, `SessionScopeHandle`, `UserScopeHandle`, `OrgScopeHandle`, `RequestScopeHandle`, `ScopeStateOps`, `ViewInput`, `ViewOutput`, `ViewElement`, `FacetsOf`, `EvaluatorAnswers`, `FlowConfigInput`, `FlowConfigValue`, `InferFlowConfigFromSchema`, `FlowType`, `FlowInstance`, `ParallelStepOutput`, `FactoryConfig`, `InferCapabilities`, `ConfigArgOf`, `SlotValue`. `idx:2-22`, `:30`, `:54`, `:82`, `:126`, `:167-170`, `:254`, `:276`, `:292-298`, `:369`.
- `@flow-state-dev/core/types` (the `./types` subpath, `packages/core/package.json:35-38`) only: `FlowActionInput`, `FlowActionBlock`, `InferFlowStateMap`, `InferFlowBlockContext`, `InferScopeStateFromConfig`, `SchemaInput`, `SchemaOutput`. `tidx:97`, `:108-111`, `:431`. A search of `idx` finds none of these seven.
- `@flow-state-dev/client`: `ActionNameOf`, `ActionInputOf`, `TypedFlow`, `UntypedFlow`, `ViewValueOf`, `ViewInputOf`. `cidx:7-8`, `:35-36`, `:47-52`.
- `@flow-state-dev/react`: `ClientDataValues`. `ridx:32`.
- Not exported from any package entry (a search of `idx`, `tidx`, `cidx`, `ridx` finds none): `InferStateFromSchema`, `InferResourcesFromSchemas`, `InferResourcesFromDefinitions`, `InferBlockResources`, `InferTargetStatesFromSchemas`, `ResourceArrayElement`, `ProjectedClient`, `InferSessionState`. The page does not list them. `blk:1458-1510`, `res:382`, `cp:47`, `cap:227`.

## 1. Extract a block's types

| Helper | Resolves to | From | Source |
|---|---|---|---|
| `BlockInput<T>` | The output side (`_output`) of `T.inputSchema`. `never` when `T` has no `inputSchema` property. | A block (`typeof myBlock`). | `blk:1447-1448` |
| `BlockOutput<T>` | The output side (`_output`) of `T.outputSchema`. `never` when `T` has no `outputSchema` property. | A block. | `blk:1450-1451` |

- Both read `_output`, so a field a schema defaults (`z.number().default(5)`) is present and non-optional in the extracted type. **[source]** `blk:1448`, `:1451`.
- Both work on any object with the schema property, not only on a `BlockDefinition`: the type argument is unconstrained `T`. A thing without the property gives `never`, not an error. **[source]** `blk:1448`.
- `BlockOutput<typeof evaluatorBlock>["answers"]` is the typed answer map of an evaluator: `["team"]["choice"]` is the union of the option keys, `["frustration"]["score"]` a `number`, `["urgent"]["probability"]` a `number`. A wrong option key does not compile. **[test]** `evat:22-35`.
- `BlockInput<typeof tickets.search>` on a faceted collection's `search` block gives the search input: each choice question's option keys, all optional. **[test]** `fct:36-42`.
- A sequencer's `outputSchema` is optional (`ts-doc` "Sequencers also accept an optional `outputSchema`"); the page does not state what `BlockOutput` gives for a sequencer built without one, which was not checked.
- `ts-doc` shows `type SearchOutput = BlockOutput<typeof search>; // { title: string; url: string }[]`, which is correct for the array schema in its example. **[doc]**

### Related block types

| Helper | What it is | Source |
|---|---|---|
| `BlockDefinition<TInputSchema, TOutputSchema, TInput, TOutput>` | The type `handler()`, `generator()`, `evaluator()` and `router()` return. `sequencer()` returns `SequencerDefinition`, a builder interface that `extends BlockDefinition<any, any>`. Defaults: `ZodTypeAny` for both schemas, `z.infer` of each for the value types. It has no `run` method, so `block.run(input, ctx)` inside a handler does not compile. | `blk:1196-1215`; `hd:161`; `gen:2852`; `rt:198`; `sm:156-161` |
| `BlockKind` | `"handler" \| "generator" \| "evaluator" \| "sequencer" \| "router"`, the type of `block.kind`. | `blk:43` |
| `BlockContext<TRequestState, TSessionState, TUserState, TOrgState, TResources, TSequencerState, TParentInput, TTargets, TCapabilities, TSelfState, ...>` | What `ctx` is inside `execute`. The state, resources, sequencer-state and targets parameters default to an open record (`Record<string, unknown>`, or the open resource and target maps). `TCapabilities` defaults to `{}`, `TParentInput` to `unknown`, `TFlowConfig` to `Readonly<Record<string, unknown>>`. | `blk:326-358` |
| `BlockResult<TOutput>` | A four-way union on `status`: `{ status: "not_started" }`, `{ status: "running" }`, `{ status: "completed"; output: TOutput }`, `{ status: "failed"; error: Error }`. | `blk:222-226` |

- Every typed `ctx` a block's factory produces is assignable to a plain `BlockContext` parameter, whichever of these the block declared: request, session, user, own or parent state schemas, capabilities in `uses`, resources, targets. A helper typed `(ctx: BlockContext)` therefore accepts any block's `ctx` with no cast. **[test]** `bca:1-50`.
- `BlockContext`'s `TTargets` default is the open map, which is what makes the previous bullet hold for a block that declares targets. **[source]** `blk:336-340`.

## 2. Extract state and context types

| Helper | Resolves to | From | Source |
|---|---|---|---|
| `StateOf<T>` | `T["stateSchema"]["_output"]` when `T` has a `stateSchema` that is a Zod type; else `T["_output"]` when `T` is itself a Zod type; else `never`. | A resource or resource collection definition, a scope config (`session`, `user`, `org`, `request` block of a flow), or a bare Zod schema. | `res:555-559` |
| `ContextOf<T, Kind>` | By `Kind`: `"resource"` (the default) gives `ResourceContext<StateOf<T>>`; `"session"` gives `SessionScopeHandle<StateOf<T>>`; `"request"` gives `RequestScopeHandle<...>`; `"user"` gives `UserScopeHandle<...>`; anything else gives `OrgScopeHandle<...>`. The state is `StateOf<T>` when that is an object, else a plain `JsonObject`. A third type parameter is accepted and ignored. | A resource, scope config or schema, plus a kind string. | `res:564-585`, `:561` |
| `ResourceContext<TState>` | The handle `ctx.resources.<name>` exposes: `state` (readonly), `patchState`, `setState`, `updateState`, `incState`, `pushState`, and `edges` when the resource declared edges. The state parameter is a `JsonObject`. | A state type. | `res:385-411` |
| `ClientDataOf<T>` | The client-projection type of a defined resource or resource collection: `Pick<State, listed>` from `client.expose`, `Omit<State, listed>` from `client.exclude`, the awaited return type of `client.data`, else the whole state. `never` for anything that is not a defined resource or collection. | A resource or collection (`typeof artifacts`, or `typeof flow.resources.notes`). | `res:421-441`; `cp:36-53` |

- `StateOf` reads the **output** side of the schema, so a defaulted field is present. **[source]** `res:555-559`.
- `ContextOf` with an unlisted kind string does not error from the constraint on `TKind`: only the five kinds compile (`"resource" | "request" | "session" | "user" | "org"`). **[source]** `res:576-580`.
- `ClientDataOf<typeof exposed.collection>` with `client: { expose: ["title"] }` is `{ title: string }`. Adding a key that was not exposed (`secret`) is a compile error. The same type comes from `ClientDataOf<typeof exposed.resources.notes>`, the registered handle on a faceted collection's `resources`. **[test]** `fct:76-87`.
- The runtime payload of client data stays `JsonValue`. `ClientDataOf` is a compile-time brand and changes no data. **[source]** `res:413-419`; **[doc]** `core-rd:457`.
- For a `data` projection the projection function's return type is what is captured, so the function's return should be annotated for a precise type. **[doc]** `core-rd:457`.
- One test of `ClientDataOf` on a projected collection carries a `@ts-expect-error` over an assertion: the resolved type is not yet `{ ticker: string }` for `defineProjectedResourceCollection` with `expose`. The page does not claim a projected collection's `ClientDataOf` is exact. **[test]** `pct:137-148`. Pass 5 should read this as an open gap, not a guarantee.
- `useResourceCollection<TClient = unknown>`, `useResourceCollectionList<TClient = unknown>` and `useCollectionResource<TClient = unknown>` take the projection as a type parameter; without it `clientData` is `unknown`. `useResource<TDef extends ScopeResourceDef>(def, options)` takes the definition as an argument and infers the value type (`ClientValue<TDef>`); it has no projection parameter. **[source]** `react/src/hooks/useResource.ts:178`, `useResourceCollection.ts:174`, `useResourceCollectionList.ts:77`, `useCollectionResource.ts:30`.

### Scope handles

| Helper | Shape | Source |
|---|---|---|
| `SessionScopeHandle<TState>` | `identity`, `lineageId?`, `state` (readonly), `metadata`, `items`, `window?`, `appendJournal`, `getJournal`, `setMetadata`, `stopRequest`, plus every method of `ScopeStateOps<TState>`. | `sc:295-324` |
| `UserScopeHandle<TState>` | `identity`, `state` (readonly), plus `ScopeStateOps<TState>`. | `sc:326-331` |
| `OrgScopeHandle<TState>` | The same members as `UserScopeHandle`. | `sc:333-338` |
| `RequestScopeHandle<TState>` | `identity`, `incarnation`, `attachments`, `state` (readonly), `tokenUsage`, `costEstimate`, plus every method of `ScopeStateOps<TState>`. Members read from `sc:220-250`; the page re-reads that range before listing, since only the field names were extracted. | `sc:220-250` |
| `ScopeStateOps<TState>` | `patchState(updates)` and `patchState(key, updater)`, `setState`, `incState(increments)`, `pushState(field, value)`, `setStateRecord(field, key, value)`, `deleteStateRecord(field, key)`, `atomicState(mutator)`. Every method resolves to a boolean: `true` when the write changed state, `false` when the new value was structurally equal to the current one (the write and its `state_change` event are then skipped). | `st:25-48` |

- The TState parameter of each scope handle defaults to `Record<string, unknown>`. **[source]** `sc:295-298`, `:326-336`.
- `ts-doc` lists `ScopeStateOps` members as `patchState`, `setState`, `incState`, `setStateRecord`, `deleteStateRecord`, `atomicState`: it omits `pushState` and does not say the methods return a boolean. The page lists all eight forms. **[source]** `st:34-48`.

## 3. Get an action's types (flow and client)

| Helper | Resolves to | From | Source |
|---|---|---|---|
| `FlowActionInput<TAction>` | `TAction["block"]["inputSchema"]["_output"]`: the action's block's input type. | One action entry, such as `typeof flow.actions.chat`. Constraint: `ActionConfig`. Import from `@flow-state-dev/core/types`. | `ft:949` |
| `FlowActionBlock<TAction>` | `TAction["block"]`: the block an action runs. | The same. | `ft:951` |
| `ActionNameOf<TFlow>` | The action names a flow type has: `keyof TFlow["actions"] & string`. `string` when the flow type is `UntypedFlow`. | `typeof myFlow`. | `cl:296-298` |
| `ActionInputOf<TFlow, TAction>` | `FlowActionInput<TFlow["actions"][TAction]>`. `unknown` for `UntypedFlow`. `never` when `TAction` is not an action of the flow. | `typeof myFlow` plus an action name. | `cl:300-306` |
| `TypedFlow` | `{ actions: Record<string, ActionConfig> }`: the constraint a flow type must meet. | | `cl:289-290` |
| `UntypedFlow` | `{ actions: Record<string, never> }`: the flow type `client.flow(address)` uses when none is given. Any action name, input `unknown`. | | `cl:292-293` |

**How do you get an action's input type on the client?** `ActionInputOf<typeof myFlow, "actionName">`, imported from `@flow-state-dev/client`; `myFlow` is the value `defineFlow` returned, imported as a type only (`import type { myFlow } from "./flows/my-flow"`), so no server code reaches the browser bundle. **[source]** `cl:300-306`; **[doc]** `cl-rd:70-82`. Equivalent on the server side: `FlowActionInput<typeof myFlow.actions.chat>` from `@flow-state-dev/core/types`. **[test]** `aet:21-27`.

- `client.flow<typeof myFlow>("address")` returns a `FlowHandle<typeof myFlow>`. Its `send(action, input, options?)` takes `action` as `ActionNameOf<TFlow>` and `input` as `ActionInputOf<TFlow, TAction>`. An unknown action name or a wrong input shape does not compile. **[test]** `clt:161-170`; **[source]** `cl:431-445`, `:538`.
- `client.flow("address")` with no type argument is untyped: any name, `unknown` input. **[doc]** `cl-rd:78-82`; **[source]** `cl:292-293`, `:538`.
- A collection copy is addressed by its instance id and typed the same way: `flow<typeof demoFlow>("demo-copy-2")`. **[test]** `clt:172-176`.
- A bare block in `actions` and the `{ block }` form give the same action type: both are `ActionConfig<typeof block>`, so `FlowActionInput` of either is the block's input. **[test]** `aet:21-27`; `ft:298-317`.
- `FlowActionInput` reads the **block's** `inputSchema`. An action-level `inputSchema` override (`ActionCore.inputSchema`, `ft:204-209`) is not what the helper reads. A field with a schema default is present and non-optional in the type, because the helper reads `_output`. **[source]** `ft:949`. State this flat; do not claim the client rejects an omitted defaulted field at runtime, which no test here pins.
- `ActionEntry<TBlock>` is `TBlock | ActionConfig<TBlock>`: the form an author writes in `actions`. `NormalizedActions<TActions>` is the form `defineFlow` publishes: each bare block becomes `{ block }`. `ActionConfig` is exported from `@flow-state-dev/core`. **[source]** `ft:298-317`; `idx` (search `ActionConfig`, `ActionEntry`, `NormalizedActions`).

## 4. Types of a flow's declared state and config

| Helper | Resolves to | From | Source |
|---|---|---|---|
| `InferScopeStateFromConfig<TScopeConfig>` | `stateSchema["_output"]` of a scope config; `Record<string, never>` when it has no `stateSchema`. | A scope config. `@flow-state-dev/core/types`. | `ft:927-933` |
| `InferFlowStateMap<TDefinition>` | `{ request, session, user, org }`, each by `InferScopeStateFromConfig` of the definition's matching scope. | A `FlowDefinition`. `core/types`. | `ft:935-940` |
| `InferFlowBlockContext<TDefinition>` | `BlockContext<request, session, user, org>` state types from `InferFlowStateMap`. | A `FlowDefinition`. `core/types`. | `ft:942-947` |
| `FlowConfigInput<TConfigSchema>` | The input side (`_input`) of a flow's `configSchema`, so a key with `.default()` may be omitted. `never` when the flow declares no `configSchema`. | `TConfigSchema extends ZodTypeAny \| undefined`. | `ft:518-520` |
| `FlowConfigValue<TConfigSchema>` | `Readonly` of the schema's output side, defaults present. `Readonly<Record<string, unknown>>` when no schema. | The same. | `ft:526-529` |
| `InferFlowConfigFromSchema<TSchema>` | A block's view of the config bag: `Readonly<z.infer<TSchema>>` when it is an object, else `Readonly<Record<string, unknown>>`, also when the block declared no `flowConfigSchema`. Read as `ctx.flow.config`. | A block's `flowConfigSchema`. | `blk:293-302` |

- `ts-doc` says `defineFlow` makes scope state types "available to the `client` block"; the types a derived client function sees are `ctx.state` (the scope's state) and `ctx.resources.<name>.state`. **[doc]** `ts-doc` "Flow-level inference".

### Properties of a flow type and a flow instance (carried from the Flows page, corrected by its pass 5)

This is the row the Flows depth pass moved here. Each clause checked against code.

- `defineFlow(...)` returns a callable `FlowType`. Calling it returns a `FlowInstance`. `ft:858-925` (`FlowType`), `ft:773-` (`FlowInstance`).
- **The definition** (`FlowType`) carries `kind`, `cardinality` (`"singleton"` or `"collection"`), `requireUser`, `config`, `requiresConfig`, `authentication`, `actions`, and the normalized rest: `internal`, `task`, `views`, `session`, `request`, `user`, `org`, `resources`, `tools`, `voice`, `mcp`, `webhooks`, `schedules`, `isolateUserState`, `isolateOrgState`. `ft:858-925`; `df:1678-1700`. The row's six named properties are all present and correct: `cardinality` `ft:869`, `requireUser` `ft:870`, `config` `ft:877`, `requiresConfig` `ft:887`, `actions` `ft:889`.
- **`requiresConfig` is `true`** when the `configSchema` does not parse `{}`, or when the value that parse produced does not satisfy a block's `flowConfigSchema`. Otherwise `false`; a flow with no `configSchema` and no block `flowConfigSchema` is `false`. `df:1648-1675`; **[test]** `fcf:217`, `:253`, `:267`. The row's wording is accurate. The block case is `findFlowConfigMismatch` against the default bag, `df:1671-1675`.
- **The definition's `config`** is the `configSchema` parsed against `{}`, frozen, defaults included. It is the frozen empty object when that parse fails, and then `requiresConfig` is `true`. `df:1655-1670`; **[test]** `fcf:216-219`, `:247-253`.
- **The instance** (`FlowInstance`) carries `id`, `kind`, `cardinality`, `requireUser`, `config`, and the same normalized rest as the definition. `ft:773-803`; `df:1595-1600`. `id` is the flow's global address: for a singleton it equals `kind`, for a collection member it is the explicit id passed to the factory. `ft:785-790`.
- **The instance's `config`** is the bag parsed against `configSchema` and deep-frozen at the top level only (`Object.freeze` is shallow). A flow that declares no `configSchema` carries a frozen empty object, never `undefined`. `df:240`, `:353`; **[test]** `fcf:81-97`, `:261-266`. Blocks read it as `ctx.flow.config`. `ft` doc comment on `FlowInstance.config`.
- **`cardinality` is definition-only**: setting it in an instance's options is refused. A `"collection"` flow's every instance needs an explicit `id`, and that id is the only address it answers to. `df:189-215`, `:411-425`; `ft:509-517`.
- Drop the claim, if the page makes it, that `FlowInstance` and `FlowType` are interchangeable: only the definition is callable, and only the definition carries `requiresConfig`. **[source]** `ft:773-850` has no `requiresConfig`; `ft:887` does.
- The flows row is a runtime-properties row, not a type-extraction row. It lands on this page as the two rows `FlowType` and `FlowInstance` under "what each flow type is".

## 5. Views, evaluators, composition and kits

| Helper | Resolves to | From | Source |
|---|---|---|---|
| `ViewOutput<TView>` | `BlockOutput<TView["block"]>`: what the view answers. | A view definition, `typeof myView`. Constraint: has a `block`. | `vw:61` |
| `ViewInput<TView>` | `BlockInput<TView["block"]>`. | The same. | `vw:64` |
| `ViewElement<TBlock>` | The element type of a block whose output is a list (`readonly (infer E)[]`), else `never`. It types a keyed view's `key(entry)` function. | A block. | `vw:21-23`, `:42-48` |
| `ViewValueOf<TRef>` (client) | `ViewOutput<TView>` for a `ViewRef<TView>`; `unknown` for anything else. | `viewRef<typeof roster>(flow, view)`. | `cv:44-45` |
| `ViewInputOf<TRef>` (client) | `ViewInput<TView>` for a `ViewRef<TView>`; `unknown` otherwise. | The same. | `cv:47-48` |
| `FacetsOf<TEvaluator>` | The `answers` of an evaluator block's output: what a faceted collection stores. `never` when the block's output has no `answers`. | An evaluator block. | `fac:73-74` |
| `EvaluatorAnswers<TQuestions>` | A map keyed by question id of each question's answer type. | The `questions` object. | `evt:121-124` |
| `ParallelStepOutput<TStep>` | The output type of one step of a sequencer's `.parallel({...})`: the block's `outputSchema` output, or, for a `{ connector, block }` step, the block's. `never` otherwise. | One parallel step. | `sm:55-59` |
| `FactoryConfig<TFactory>` | The parameter type of a block factory function: `TFactory extends (config: infer C) => any ? C : never`. | `typeof createMyBlock`. | `sm:86-87` |
| `InferCapabilities<TUses>` | The helper namespaces `ctx.cap` carries, from a `uses` array: capability name mapped to its helper functions, intersected. `{}` when `uses` has no static capability. A dynamic `uses` entry (a function) contributes nothing. | A `uses` tuple. | `cap:612-624` |
| `ConfigArgOf<Self>` | The argument type of a capability's `.config()` call. `never` when the capability declares no config, so `.config()` is a compile error on it. | A defined capability. | `cap:333-340` |
| `SlotValue<S>` | What a kit's `install` receives for a slot: `Readonly<Record<string, T>>` for a keyed slot, `readonly T[]` for a list slot. | A slot declaration. | `kit:47-49` |
| `SchemaInput<T>` / `SchemaOutput<T>` | `T["_input"]` / `T["_output"]` of a Zod type; `never` for anything else. `@flow-state-dev/core/types`. | A Zod schema. | `sch:9-10`; `tidx:431` |

- A view's `block` must declare an `outputSchema`; `ViewOutput` is that schema's output. `vw:9-14`, `:35-37`.
- `ViewValueOf<typeof rosterView>[number]` is one roster entry; the workforce package pins that this type and the documented `RosterEntry` agree key for key. **[test]** `rvt:20-27`.
- A static capability in `uses` is reflected into a block's `ctx` types. This is **direct only**: a capability a capability uses does not flow to the consuming block. A dynamic `uses` entry contributes nothing to types. **[doc]** `ts-doc` "Capability-declared schemas"; **[source]** `cap:612-624`.
- The four axes a capability declares into a block's types: `sessionStateSchema`, `resources`, `targetStateSchemas`, `sequencerStateSchema`. A block's own keys win on collision, except `resources`: two different `defineResource()` references under one accessor throw `Resource conflict` at block construction. **[doc]** `ts-doc` "Capability-declared schemas". The helpers that compute each are not exported (`InferCapabilitySessionState`, `InferCapabilityResources`, `InferCapabilityTargets`, `InferCapabilityTargetSchemas`, `InferCapabilitySequencerState` live at `cap:645-773`); only `InferCapabilities` and `ConfigArgOf` are public (`idx:167-170`). The Capabilities page owns this; this page links to it.

## 6. React

| Helper | Resolves to | From | Source |
|---|---|---|---|
| `ClientDataValues<TOptions>` | The value `useClientData(session, options)` returns, by scope the options name: `{ session?: ..., user?: ..., org?: ... }`. For one scope given as an array of names: each name maps to `unknown`. Given as an object of `name: zodSchema`: each name maps to the schema's output type. A `name: true` entry maps to `unknown`. | The `options` object passed to `useClientData`. | `ucd:36-64`, `:89-92` |

- A scope the options do not name is absent from the result type. **[source]** `ucd:55-64`.
- Pass the schema to get a typed value: `useClientData(session, { session: { mode: modeSchema } })` types `data.session.mode` as the schema's output. Without schemas each value is `unknown`. **[source]** `ucd:46-47`; **[doc]** `re-rd:147-` (read this section before writing the example).
- `ZodSchemaLike` is any object with `_output?` and `parse?`, exported from the hook file. Whether the package entry re-exports it was not checked; the page does not name it. `ucd:13-16`.

## 7. Existing page `ts-doc` contradicts the code: do not carry these

1. **`LooseBlockContext` does not exist.** `ts-doc` documents it as a type helper with usage guidance ("When to reach for `LooseBlockContext`"). A search of every `.ts` and `.tsx` file under `packages/` finds no definition and no export, and `idx` has no export of it. The type that replaced the need is the plain `BlockContext`, which every typed `ctx` is assignable to: **[test]** `bca:1-50`. Drop the row. The page's guidance for a helper taking a block's ctx is `(ctx: BlockContext)`.
2. **`BlockResult<TOutput>` is not "the handler `execute` return-value union".** It is the four-state union on `status`, section 1. `ts-doc` is wrong. `blk:222-226`.
3. **`ScopeStateOps` lists six methods in `ts-doc`; the interface has eight forms** (adds `pushState` and the `patchState(key, updater)` overload) and every method returns a boolean. Section 2.
4. **`ts-doc` says `BlockDefinition` is "the return type of `handler()`, `generator()`, `evaluator()`, `sequencer()`, and `router()`".** `sequencer()` returns `SequencerDefinition`, a builder with `.step`, `.parallel`, `.map`. `SequencerDefinition extends BlockDefinition<any, any>`, so a sequencer is assignable wherever a `BlockDefinition` is taken, but `sequencer()`'s declared return type is the narrower builder. `sm:156-161`, `sq:2584`.
5. **`ContextOf` in `ts-doc` is described as "Context handle type for a scope or resource"** and its `Kind` parameter is not named. The five kinds are listed in section 2.
6. **`ts-doc` types `FlowActionInput` nowhere.** It does not mention `ActionInputOf`, `ActionNameOf` or `FlowActionInput`, the answer to the page's one lookup. Their only existing user-doc mention is `cl-rd:70-82` (the `flow<typeof supportFlow>` example). Sections 3 and the lookup are new content, written from the signatures.

## 8. Other rows from `ts-doc` that are correct but belong elsewhere (dropped from this page)

- "Schema in, types out", "Types flow through sequencers", "Parallel steps produce typed objects", "State and resources are typed per-block", "Generators infer tool types", "Flow-level inference" and the "What you don't have to write" table describe how inference works. They are a Concepts page, not Reference rows, and are not in R-38's plan (the plan's source line names only the helper tables). Not carried.
- `handler.withDefaults` and its defaultable fields (`sessionStateSchema`, `userStateSchema`, `orgStateSchema`, `requestStateSchema`, `sequencerStateSchema`, `resources`, `outputSchema`, `uses`; `name`, `inputSchema`, `execute`, `description` stay per call): this is a block-authoring function, not a type helper. It belongs to Blocks (R-01). `hd:210-262`, `:296-306`. Not carried.
- Capability resource-conflict rule: owned by the Capabilities page. Section 5 links, does not restate.

## 9. Rows other pages moved to R-38

One row, from `docs/contributing/docs-revamp/pages/reference/flows.record.md` line 105, depth pass 5, corrected by pass 5: **"Properties on a definition and on an instance"** (the six named properties on a definition; five on an instance; `requiresConfig`'s two conditions; the instance's `config` frozen empty when there is no `configSchema`).

- **Carried, all of it, as true.** Section 4 checks each clause against `ft`, `df` and `fcf`. The one addition from the code: the definition's own `config` (what a bagless mint would carry) and `authentication`; the row's "plus the rest of its normalized settings" covers the rest.
- **Dropped:** none of the clauses. The row is worded as properties, and the page places it as two rows (`FlowType`, `FlowInstance`) under section 4, not as a sentence.
- The Flows page declined an earlier version of this move because no R-38 page existed and nothing else stated `requiresConfig`. R-38 is now where the row lands, and Flows (R-05) should link here. `flows.record.md` line 78 (finding 25).

## 10. Imports the page's examples use

Titles follow `docs/contributing/user-docs.md` "Code examples". A realistic block for the carried example (one block, one flow, one client file):

- `src/flows/support/blocks/draft-reply.ts`: `handler` from `@flow-state-dev/core`; `z` from `zod`. `inputSchema: z.object({ ticketId: z.string(), tone: z.enum(["formal", "friendly"]).default("friendly") })`, `outputSchema: z.object({ reply: z.string() })`.
- Server side: `import type { BlockInput, BlockOutput } from "@flow-state-dev/core"` then `BlockInput<typeof draftReply>` gives `{ ticketId: string; tone: "formal" | "friendly" }` (output side: `tone` is present). **[source]** `blk:1448`.
- Client side, `src/lib/support-client.ts`: `import { createClient, type ActionInputOf } from "@flow-state-dev/client"; import type { supportFlow } from "../flows/support/flow";` then `type ReplyInput = ActionInputOf<typeof supportFlow, "reply">;` and `createClient({ userId }).flow<typeof supportFlow>("support").send("reply", input)`. `createClient` takes `{ userId, baseUrl?, apiPath?, fetcher? }`. **[doc]** `cl-rd:70-82`; **[test]** `clt:161-165`.
- Every example must type-check against the package source (pass 4). The defaulted-field behaviour in the second bullet is the one most likely to surprise: check that `send("reply", { ticketId: "t-1" })` does or does not compile before the page shows it, and write the example to match.

## 11. Open points for pass 5

1. `BlockOutput` of a sequencer built without an `outputSchema`: unchecked, kept off the page.
2. `RequestScopeHandle` members: field names were extracted, not each type; re-read `sc:220-250` before listing.
4. `ClientDataOf` on a projected collection: one test asserts the gap with `@ts-expect-error` (`pct:144-147`); the page does not promise it.
5. Whether a defaulted action-input field must be passed to `send`: not pinned by any test read; check by compiling a probe in pass 4.

## 12. Corrections from revise round 1

Read from the code after the fact check. The page no longer states the first four; they moved to other Reference pages, and the corrected form is recorded here so the move carries the true version.

1. `ParallelStepOutput<TStep>` reads `outputSchema._output` straight off a bare block first, then `block.outputSchema._output` off a `{ connector, block }` step. `never` only when neither has an output schema. A bare block step yields its output. `sm:46-60`. Section 5's row ("`never` otherwise" for a bare block) was untrue.
2. `useResourceCollectionItem` does not exist. `useResourceCollection` and `useResourceCollectionList` take the projection as a `TClient` type parameter (default `unknown`); `useResource` takes the resource definition and types `clientData` from it. Section 2's last bullet was wrong; the page carries none of it.
3. `ClientDataOf` of a `defineProjectedResourceCollection` with `expose` resolves to `Pick<any, "ticker">`, which is `{ ticker: any }`: the exposed keys with `any` values, because the collection's state is inferred as `any`. `pct:137-148`. The page states nothing about it; Resources owns it.
4. Setting `cardinality` in an instance's options throws when the instance is created (`rejectInstanceCardinality`, `df:~195-205`). It is not a compile error. The page states nothing about it; Flows owns it.
5. Helpers that give `unknown` (`ActionInputOf` and `ViewValueOf` on an untyped input, `ClientDataValues` array and `true` forms) or a record (`InferScopeStateFromConfig`, `FlowConfigValue`, `InferFlowConfigFromSchema`) are named in their rows. The Quick answers line says `never` for most and points at the rows that differ.
6. `supportFlow` is `defineFlow({ kind: "support", actions: { reply: draftReply } })` in `src/flows/support/flow.ts`; pass 4 type-checked it as a stub with the other examples.

## 13. Corrections from revise round 2

1. `useResourceCollectionItem` is named in `packages/react/README.md:188-197` and `core/README.md:457` but no source file or `index.ts` export defines it (grep of `packages/react/src` finds none). The one-item hook is `useCollectionResource(session, ref, topic)`, which takes `TClient = unknown` and returns `{ item, isLoading, error, refetch }`; `item.clientData` is `TClient`. `react/src/hooks/useCollectionResource.ts:20-35`, `react/src/index.ts:61`. The page uses `useCollectionResource`. The README names are stale; flag for the README owner.
2. The page now states that a typed `ctx` from any block is assignable to plain `BlockContext` (`bca:1-50`, `blk:326-345`) and gives a `(ctx: BlockContext)` helper example. No older name for the type appears on the page.
3. `ScopeStateOps` row now lists all eight forms and the boolean result, `st:25-48`.
4. "On the client" now states the compile errors for a misspelled action or wrong input shape and the untyped form's behavior, `clt:161-170`, `cl:292-293`, `cl:431-445`.
5. The `ClientDataOf` React example is a compile-checked-by-reading sketch (`fct:76-87` pins the `{ title: string }` result and the compile error on `secret`); the page now defines the `tickets` collection it imports, at `src/flows/support/resources/tickets.ts` (`defineResourceCollection` with `pattern`, `scope: "session"`, a `stateSchema` of `title` and `secret`, and `client: { expose: ["title"] }`), shaped like the `expose` case in `packages/core/test/clientdata-resource-inference.type-test.ts`.
