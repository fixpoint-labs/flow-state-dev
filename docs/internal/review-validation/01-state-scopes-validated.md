# State Scopes — Validation of Original Review Claims

The first-team review (specifically `02-architecture-coherence.md` §2 and `00-team-synthesis.md` finding #7) made four moves on state scopes:

1. Drop `request` as a public concept; fold into sequencer instance state.
2. Collapse `user` and `org` into one identity scope.
3. User state should be flow-isolated by default with explicit opt-in to share.
4. (Concern #11) State vs. resources is too complex; perhaps `user`/`org`/even `session` state are not necessary because resources cover it.

The maintainer pushed back on every one. This report walks each claim through the actual code and renders a verdict. Citations are absolute file paths with line numbers as of this commit.

---

## Claim 1: "Request scope and sequencer scope overlap; drop request as a public concept"

**Verdict: ORIGINAL CLAIM IS WRONG.** The maintainer is correct.

### Code evidence

The `RequestScopeHandle` is defined at `/home/user/flow-state-dev/packages/core/src/types/scope.ts:97-102`:

```ts
export type RequestScopeHandle<TState extends object = Record<string, unknown>> = {
  identity: ScopeIdentity;
  state: Readonly<TState>;
  tokenUsage: TokenLedger;
  costEstimate: CostEstimate;
} & ScopeStateOps<TState>;
```

It is accessed from `BlockContext` at `/home/user/flow-state-dev/packages/core/src/types/block.ts:117`. It is **always present** on `ctx.request`, even when no sequencer exists. The `sequencer` field at `/home/user/flow-state-dev/packages/core/src/types/block.ts:121` is typed `sequencer?: StateRef<TSequencerState>` — `undefined` when the executing block is not running inside a sequencer.

This single fact disposes of the claim: a flow whose action is one bare handler block has `ctx.request` (with state, token usage, cost) but no `ctx.sequencer`. There is nothing to "fold into" — the sequencer scope literally does not exist for that execution path. `RequestScopeHandle` is created unconditionally in `createExecutionContext.ts:1867-1899` whenever an action runs; sequencer state refs are created lazily at sequencer entry inside `packages/core/src/blocks/sequencer.ts`.

### What request scope actually buys you

The two real production consumers of `ctx.request.state` make this concrete:

- **MCP capability** at `/home/user/flow-state-dev/packages/tools/src/mcp/capability.ts:61-79`. The capability bubbles a `requestStateSchema` so the flow gets typed `ctx.request.state.mcp.{disabledTools,disabledServers}`. The filter at `/home/user/flow-state-dev/packages/tools/src/mcp/filter.ts:14-29` reads it. This is per-turn tool filtering — purely a property of one request, not of a sequencer. There may not be a sequencer at all.

- **Tasks pattern** at `/home/user/flow-state-dev/packages/tasks/README.md:190-200` is explicit about the difference:

  > "Sequencer-backed collections lose their state at each sequencer-invocation boundary because sequencer state is per-instance. Request-backed collections persist for the request lifetime."

This is the killshot. The framework already has `ctx.sequencer.state` for "values that live across steps in one sequencer invocation." The request scope exists precisely because that lifetime is wrong for several real cases: nested or peer sequencers in the same action need a shared scratch space, and bare-handler actions need somewhere to put per-call state.

### Where the original review went wrong

The original review noted `transientSlot()` as "a workaround for the request scope being heavier than callers want." That is not what `transientSlot` does. `transientSlot()` (`/home/user/flow-state-dev/packages/core/src/utils/transient-slot.ts`) marks a sequencer-state field that should not enter the durable checkpoint store. It is a serialization concern on sequencer state, not a request-scope substitute. The original review conflated two unrelated mechanisms.

The original review also observed that "a substantial fraction of 'request state' use cases are local variables in a sequencer's instance state." That is true for the easy case — a single sequencer, no peers. It does not generalize to bare handlers, parallel sub-sequencers that need to coordinate, or capabilities that bubble per-request config. The framework cannot assume the easy case.

### Refined position on Claim 1

Request scope is a real, distinct primitive with at least two production consumers (MCP capability, tasks pattern) that depend on its lifetime semantics. Schema-bubbling into `requestStateSchema` is part of the same story — capabilities can declare "I need this typed slot on the request" and the runtime wires it up. Removing `request` from the public surface would either cut these features or force them through an awkward "implicit sequencer" wrapper.

The original review's recommendation here is rejected.

---

## Claim 2: "Collapse user + org into one identity scope"

**Verdict: ORIGINAL CLAIM IS WRONG.** The maintainer is correct that user and org are different.

### Code evidence

User and org are not parallel concepts. They have different storage routing, different cardinality (one user, possibly many orgs that contain users), and different binding semantics. The `OrgBindingMismatchError` path at `/home/user/flow-state-dev/packages/server/src/context/createExecutionContext.ts:1810` enforces orgId immutability per session — sessions are bound to an org for their lifetime, but a user belongs to themselves regardless of org context. That is structural, not cosmetic.

Storage key derivation at `/home/user/flow-state-dev/packages/server/src/stores/scope-keys.ts:49-56` treats them with the same shape (`bare id` vs `id:flowKind`), but consumers see them as separate handles (`UserScopeHandle`, `OrgScopeHandle`) with separate identity types (`userId`, `orgId`).

The maintainer's own framing — "users could roll into org, the way a `users` collection might roll into a `projects` collection" — is closer to the architectural truth than the original review's framing. A user belongs to an org; an org does not belong to a user. They are not symmetric. Collapsing them would lose the asymmetry.

### The isolation footgun the original review actually noticed

The original review's strongest point was about the *shared-by-default* footgun: by default, two flows declaring incompatible schemas over the same `userId` will silently corrupt each other. That is real, and the cross-flow registry at `/home/user/flow-state-dev/packages/server/src/registry/flow-registry.ts:51-77` exists to catch it at registration time. The registry compares schemas across non-isolated flows and throws `CrossFlowSchemaConflictError` on incompatible writes.

The maintainer's reframed concern is the right one to focus on:

> "If we did [share user state across flows freely], how do we prevent users from potentially getting access to other user data if we rely on the application to carefully segment that data on its own?"

This is asking about user-vs-user isolation, not flow-vs-flow isolation. The answer in the current code is: there is no framework-level enforcement at read time. The user storage key resolves from the `userId` passed in by the caller (`createExecutionContext.ts:1720, 1730`). If your application allows user A to make a request claiming `userId: B`, they will read B's data. The session record's `userId` is checked for consistency against the request (`createExecutionContext.ts:1798-1800`), which catches "session belongs to A, request claims B," but the *initial* `userId` is trusted. This is consistent with how every comparable framework handles identity — the framework cannot verify identity, only the application can. `requireUser: true` plus an authentication hook is the framework's contract; ownership enforcement past that is the application's job.

So the maintainer's privacy concern is real but it is a separate problem from "should user and org collapse." The right fix is documenting the auth contract loudly, not collapsing scopes.

### Refined position on Claim 2

User and org are conceptually distinct. They share a storage shape but differ in binding semantics, cardinality, and lifecycle. They should remain separate scopes. The framework should keep being honest that ownership is the application's responsibility — same as Mastra, same as LangGraph, same as every framework that ships a `userId` on the request.

The original review's recommendation here is rejected.

---

## Claim 3: "User state flow-isolated by default with explicit opt-in to share"

**Verdict: ORIGINAL CLAIM IS WRONG.** The current shared-by-default behavior matches actual usage.

### Code evidence

The kitchen-sink reference application has two flows (`chat-agent` and `rich-text-component`) that *deliberately* share user state. From `/home/user/flow-state-dev/apps/kitchen-sink/flows/rich-text-component/flow.ts:8-10`:

> "The `personalize` action reads user-scoped episodic + semantic memories captured by chat-agent. Both flows configure `memorySystem` with the same user scope, and user-scoped resources are stored at bare `userId` (no flow isolation)."

This is the entire point of user scope: cross-flow per-user persistence. Memory captured in a chat session is recalled in a personalization action. If user state were isolated by default, this would silently fail (return empty memories) until the developer figured out the isolation flag. That is a worse default than the current "share by default, isolate when you mean it."

Neither flow in the kitchen-sink sets `isolateUserState`. `chat-agent` (`flow.ts:475`) declares user-scope resources via `mem.userResources` and uses bare `userStateSchema`. The rich-text flow does the same.

### Counting realistic use cases

User state holds three rough kinds of data:

1. **Cross-flow user identity / preferences**: display name, preferred model, profile fields. Want shared.
2. **Cross-flow memory**: episodic and semantic memory built by one flow, consumed by another. Want shared. This is a flagship use case for the framework.
3. **Flow-private bookkeeping**: per-flow counters, quotas, internal state. Want isolated.

Cases 1 and 2 are the recognizable user-scope use cases that motivate user state existing at all. Case 3 is real but is the *exception*. The `flowIsolation: true` opt-in is right-sized for it. Reversing the default would force every common case to type the override.

The maintainer's pushback ("probably most flows will want to share user data") matches what the kitchen-sink demonstrates and what the framework's memory story is built on. The original review's instinct toward "isolation by default is safer" treats user state as if it were like session state (one-flow-only). It isn't — that's literally what session is for.

### Where the original review still has a point

Where the original review is genuinely on to something is the *footgun* aspect: when two flows declare overlapping but incompatible user-state schemas, sharing is silently dangerous. The cross-flow registry mitigates this — it throws at registration time, not at runtime. The maintainer should not be talked into flipping the default, but the registry's role should remain prominent in documentation.

### Refined position on Claim 3

Shared-by-default is correct. The cross-flow registry exists to make sharing safe, not to clean up after a bad default. Isolation opt-ins (`isolateUserState` at the flow level, `flowIsolation` at the resource level) cover the exception case. Reversing the default would make user-scoped memory — one of the framework's headline integrations — annoying to opt into.

The original review's recommendation here is rejected.

---

## Claim 4: "State vs. resources is too complex; user/org state may not be necessary with resources"

**Verdict: PARTIALLY RIGHT.** The two primitives are distinct and earn their keep, but the surface could be tightened. Schema bubbling is genuinely load-bearing.

### What state gives you that resources don't

State is a flat per-scope namespace into which multiple blocks contribute typed fields. Bubbling is the load-bearing mechanism: a handler at `/home/user/flow-state-dev/packages/core/src/blocks/handler.ts:44-48` can declare `requestStateSchema`, `sessionStateSchema`, `userStateSchema`, `orgStateSchema`, `sequencerStateSchema` for just the slice it needs. Capabilities can do the same (`/home/user/flow-state-dev/packages/core/src/capability/types.ts:59-62`) and merge them (`/home/user/flow-state-dev/packages/core/src/capability/merge.ts:319-329`). The flow ends up with a typed union of every consumer's needs, and `ctx.<scope>.state` is statically typed without the developer manually composing schemas.

This is exactly the framework's pitch: blocks declare their needs, the framework wires it up. Remove state and that pitch loses one of its cleanest demonstrations.

The MCP capability is the canonical example. `createMcpCapability` at `tools/src/mcp/capability.ts:61-79` declares `requestStateSchema: mcpRequestStateSchema`. Any flow that uses the capability gets `ctx.request.state.mcp.disabledTools` typed for free. The filter reads it without any extra plumbing. If MCP had to be a resource, the developer would have to declare a resource, manage its lifecycle, and the per-turn semantics would not match a resource's persistence model.

### What resources give you that state doesn't

Resources carry **identity** and **content storage**. From `docs/architecture/resources-and-client-data.md:1-7`: "Resources are concrete persisted data attached to a scope... a resource carries an intrinsic `scope`." A resource has its own version, its own content body (potentially in a separate `ContentStore`), and an explicit accessor. The artifacts capability in chat-agent (`apps/kitchen-sink/flows/chat-agent/blocks/artifacts.ts`) uses resources because each artifact is a thing with its own identity, not a key on a flat state bag.

Resources are right when the unit is a *thing*: a plan, an artifact, a document, a memory entry. State is right when the unit is a *field*: a counter, a flag, a configuration value. The doc could state this rule explicitly, but the structural distinction stands.

### Where the maintainer's question lands

The maintainer asked: "is state vs. resources too complex? Is schema bubbling good or complicated?... org/user state is not necessary with resources, and potentially neither is session."

The answer to the first half is: state vs. resources is correct as two primitives. Removing user/org state in favor of resources would be a backwards step because it would force every cross-flow per-identity field (preferences, display name, model preference) into a heavier resource shape. The current `chat-agent` user state (`apps/kitchen-sink/flows/chat-agent/flow.ts:121-125`) is three primitive fields. As resources that would be three separate `defineResource` calls and three accessors. That is worse for the simple case.

The answer to the second half is: schema bubbling is unambiguously good. It is the mechanism that lets blocks be self-documenting about their state needs and lets the framework compose them. The MCP and tasks examples are not contrived — they are how real capabilities should compose into flows. Removing bubbling would force every flow author to manually maintain a flow-level schema that matches the union of every block's needs. That is the kind of plumbing the framework was built to remove.

### Where the original review is right

The original review's harder edge is that the *number* of state surfaces is large. There are:

- Five state schemas a block can declare (`requestStateSchema`, `sessionStateSchema`, `userStateSchema`, `orgStateSchema`, `sequencerStateSchema`).
- Five `ctx.<scope>.state` paths to learn.
- Plus resources, plus client data.

Every one of those is justifiable in isolation. The aggregate cost is real for newcomers. The fix is editorial: lead with session and one of {user, resource} in the docs; defer org and request to "advanced" pages. The fix is *not* deletion of primitives. Progressive disclosure (the maintainer's stated preference) is the right tool.

### Refined position on Claim 4

State and resources are both load-bearing. State is the field-bubbling mechanism. Resources are the identity-bearing data primitive. Schema bubbling is the framework's clearest demonstration of "blocks declare their needs and the framework wires it up" — removing it would gut the pitch. The complexity the original review notices is real but lives in *documentation*, not in the primitive set.

---

## Refined recommendation (supersedes the original review on this topic)

Keep all four scopes. Keep state and resources as separate primitives. Keep schema bubbling. The original review's instinct to collapse was sound for some surfaces of the framework but wrong for state scopes specifically — the load-bearing distinctions here are not accidental.

What should change is documentation and discoverability, not the primitive set:

1. **Lead with session in docs.** Most flows need only session state to get something working. The Quick Start should not introduce `request`, `user`, or `org` until the reader is past their first running flow.
2. **Document the choice rule.** "Use state for fields, resources for things with identity." One sentence in the architecture doc, plus a side-by-side example of the chat-agent user fields (state) vs. the artifact resources (resources).
3. **Document the auth contract loudly.** The framework trusts the application's `userId`. Cross-user data access is the application's problem to solve. State this in the same paragraph as `requireUser` so a careful reader cannot miss it.
4. **Keep the cross-flow registry; document what it catches.** The registry is not "machinery cleaning up after a bad default" — it is the mechanism that makes shared-by-default safe. Position it that way.
5. **Keep `request` scope; document its niche.** Per-turn capability config (MCP), per-request scratch space across multiple sequencers (tasks). Two consumers in the codebase prove its keep. Sequencer state covers a different lifetime.
6. **Trim where appropriate, not at the scope layer.** The `targetStateSchemas` / `getTarget` API and `ctx.parent` overlap noted by the newcomer-DX review are real overlap; tackle those instead.

The original review's `Tier 3` item 24 ("Collapse `request`/`session`/`user`/`org` to `session` + `identity`. `request` becomes sequencer instance state. `org` becomes an isolation flag on `identity`. Cross-flow registry deleted.") should be retracted. Each of those four moves is a degradation against an actual production use case in the codebase.

The framework's complexity here is not accidental. It is the cost of being honest about four genuinely different lifetimes (one request, one conversation, one user across conversations, one org shared across users) and giving each a typed handle. Mastra's two-scope model is simpler at the cost of forcing the developer to model the missing scopes manually. The maintainer's choice to ship four is defensible. The job of the docs is to teach the easy two first and let the other two be there when the developer needs them.
