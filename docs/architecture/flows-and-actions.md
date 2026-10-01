# Flows and Actions

How to define a flow, its actions, scopes, hooks and tool defaults is user-facing: [Flows](../../apps/docs/docs/fundamentals/flows.md), [Flow options](../../apps/docs/docs/configuration/flow.md), [Actions](../../apps/docs/docs/fundamentals/actions.md). Action forms beyond `flow.actions` (event-addressed, dispatched) are in [Action Forms](./action-forms.md). This page holds identity, config and execution-order invariants.

## Identity and registration

- `defineFlow` returns a **FlowType**; calling it mints a **FlowInstance**. **Cardinality lives on the definition, never the instance.** `singleton` (default): one instance whose id is its kind; the factory takes no id or the kind spelled out, anything else throws. `collection`: each instance needs an explicit id.
- **Registration is by exact global id.** `FlowRegistry.get(id)` is the only lookup: a singleton by kind, a collection member by id, a collection's bare kind by nothing. Duplicate ids, a singleton under a custom id, a collection member without one, or a kind mixing cardinalities is a `FlowIdentityConflictError` at `register`. **There is no first-registered fallback anywhere.** A structural instance with no `cardinality` (older code, test doubles) is admitted as a singleton only if its id is absent or equals its kind.
- `evalFlow` / `testFlow` labels (`id: "eval-run"`) never touch the registry and are not addresses.
- The route segment named `:flowKind` carries the **instance id**. See [Server and Client](./server-and-client.md).

## Instance config (`FlowInstance.config`)

`configSchema` on the definition declares the shape; `config` on the factory call supplies the values.

- **Never persisted, never on the wire, never part of a storage key.** The isolation coordinate stays `flow.id` alone, so two copies with identical bags never merge storage, and a durable request resuming after a deploy runs on the new settings: there is no stored copy to reconcile.
- Always present (a flow with no schema carries a frozen `{}`), frozen **shallowly**.
- **Closed shallowly.** An undeclared top-level key refuses by name. One level down, a nested object schema parses on its own terms, so an undeclared nested key is *stripped* when that object's declared keys are all optional/defaulted (otherwise the parse fails on the missing required key). A nested key can go missing but never come out wrong. A `catchall` is refused outright. Closing the whole tree would mean rebuilding author schemas node by node, judged riskier than the gap.
- Normalised on the **mint** half of the factory, not at definition, so a required field doesn't make every configured definition throw before a bag is supplied. `FlowType.config` is one `safeParse({})` probe (what a bagless mint gets). `requiresConfig` is true when that probe fails or doesn't satisfy a declaring block, and it is the only thing the registry reads to refuse a definition handed over in place of an instance.

### Block requirements travel to the flow

A block's `flowConfigSchema` declares what it needs of any flow that installs it. `walkBlockGraph` (`helpers/block-graph.ts`, shared because `defineFlow` imports `generator`) collects these into `requiredFlowConfig`, deduped by schema reference, including through static-tool edges. That list is **build-time only** and deliberately not on `FlowInstance`.

- **Two refusals at the two decidable moments.** At definition: a reachable block requires config and the flow declares no `configSchema`. At each mint: the parsed bag fails a block's schema. The mint check is a `safeParse` of the real value, which is exact (refinements, unions, defaults) but **per copy**: a flow looser than its blocks is refused at every mint that omits the field, not where the two were written.
- **Contradictory block requirements** (one wants `model: string`, another `model: number`) are caught only at the mint. Deciding whether two Zod schemas can ever agree isn't implementable to a promise-worthy standard, and a partial definition-time check would read as a guarantee it isn't. That is also why `requiredFlowConfig` is a list, not a merge: no silent reconciliation.
- **Function-valued `tools`** resolve per call, invisible to the mint. `generator` runs `walkBlockGraph` over what the function returned and checks the running copy's bag before the list reaches the model.

### The block-context boundary is a type, not enforcement

`BlockContext.flow` is `FlowContextView`, which exposes exactly one member: `config`. Exposing the instance would let a block reach the action/task/internal maps and step around the claim and dispatch gates built on them. A type-test asserts the absence of `actions`, `task`, `internal`, `resources` and `id`.

At runtime `createExecutionContext` holds the whole instance, so `(ctx as any).flow.actions` works. That is accepted: the boundary prevents accidents and drift, and a cast shows up in review. **Never cite it as proof a block cannot reach those maps.**

## Request execution order

1. Resolve the flow instance by exact id and the action.
2. Validate input against the action `inputSchema` (defaults to the block's).
3. Admit ownership: a named `sessionId` / `requestId` must be owned by the resolved instance (`resolveRecordOwner`), else `FlowInstanceBindingMismatchError` **before any write**. A record with no recorded owner resolves to its kind's singleton, or `migration-required` for a collection kind.
4. Resolve or create the session (ephemeral without a `sessionId`), stamping `flowId` (owner) and `flowKind` (definition) on new session and request records and the active-request entry.
5. Require user context.
6. Create request scope and state.
7. Emit the user message item if `userMessage` is defined.
8. Fire `request.onStarted`.
9. Run the root block via `block.run(input, ctx)`, then wait for its `.sideChain()` work.
10. **Success:** fire action + request `onCompleted`, *then* persist the terminal record and emit terminal status. **Failure:** persist and emit *first*, then fire `onErrored`.
11. Fire `request.onFinished`.
12. Wait for `.sideChain()` work the hooks queued, then stamp `finalizedAtMs` as the record's last write (see [Streaming](./streaming.md)).

A run that calls `ctx.suspend()` ends `suspended`: no `onCompleted` / `onErrored` / `onFinished`, no terminal-hook drain, no `finalizedAtMs`, because the id stays resumable. Session retention evicts only completed requests, so it keeps suspended ones.

Retry, continue and resume re-enter the instance recorded as the request's owner (the `:flowKind` segment must equal it); interrupted-request recovery groups by owner.

Hook names are past tense by contract; present tense is reserved for future pre-execution hooks.
