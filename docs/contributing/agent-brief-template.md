# Agent-Brief Template

Use this template for Linear issue bodies that an AFK agent is expected to pick up directly — issues that are too small to warrant a full implementation spec via `issue-spec`, but still need clarity strong enough that an agent can implement them without asking questions.

When `issue-spec` produces a full spec document, the issue body is the *what / why* and the spec is the *how* — different shape entirely. This template is for the **lightweight path**: the issue body IS the implementation contract.

The template below is already fold-shaped — the problem leads, and nothing precedes it. Two things from [`writing-for-humans.md`](writing-for-humans.md) still apply and aren't restated here: the **~100-word ceiling** on a Linear issue's above-the-fold half, and the fact that **Linear renders neither `<details>` nor collapsed blocks** — so detail goes below a `---` under a `## Detail` heading, in that order, rather than in a collapsed block.

## Principles

### Durability over precision

An issue may sit in the queue for days before an agent picks it up. Files get renamed, refactored, or moved in the meantime. Write the brief so it stays useful even when the surrounding code shifts.

- **Do** describe behaviors, type/contract shapes, and named exports the agent should look for or modify.
- **Avoid** line numbers and brittle file paths (a path is fine if the file genuinely won't move; line numbers never are).
- **Avoid** language that assumes the current implementation structure stays the same.

### Behavioral, not procedural

Describe **what** the system should do, not **how** to implement it. The agent will explore the codebase fresh and make its own implementation decisions within FSD's conventions.

- **Good:** "Generators that emit a `block_output` item with a `toolCall` of status `failed` must surface a `step_error` item to the client with the tool name and the underlying error message."
- **Bad:** "In `packages/engine/src/execution/runGenerator.ts` around line 240, add a check after the catch block..."

### Complete acceptance criteria

The agent needs to know when it's done. Each criterion is independently verifiable — a vitest test, a `fsdev run` trace assertion, a `fsdev block` invocation, or a typecheck pass.

### Explicit scope boundaries

State what is **out of scope**. Prevents gold-plating and clarifies what the next issue in the chain will cover.

## Template

```markdown
## What we're solving

One or two sentences on the problem or opportunity. PM/user lens — what's
broken, missing, or worth doing. No solution detail.

## Current behavior

For bugs: the broken behavior. For enhancements: the status quo the
change builds on.

## Desired behavior

What should happen after the change is in. Be specific about edge cases,
error conditions, and observable outcomes through the stream / state /
return values.

## Key surfaces

Named contracts the agent should look for or modify. Use FSD vocabulary:

- `<TypeName>` / `<ZodSchema>` — what needs to change and why
- `<blockName>` / `<generatorName>` / `<patternName>` / `<capabilityName>`
   — the behavioral contract
- Item types emitted (`message`, `block_output`, `state_change`, etc.)
- State scopes touched (request / session / user / project) and which
   resources or keys
- Package boundaries crossed (server / client / react / cli)

Reference `docs/architecture/<area>.md` for any contract this touches —
the architecture doc, not a file path, is the durable anchor.

## Acceptance criteria

- [ ] Specific, testable criterion 1
- [ ] Specific, testable criterion 2
- [ ] (If a generator output schema is affected) Asserted with
       `makeSchemaStrict` per BP-016
- [ ] (If user-facing) Updates to `packages/<pkg>/README.md` and any
       affected `apps/docs` pages land in the same change set
- [ ] `pnpm --filter @flow-state-dev/<pkg> typecheck && pnpm --filter @flow-state-dev/<pkg> test` passes

## Out of scope

- Adjacent feature X — that's <ISSUE-ID> or a future ticket
- Refactor of Y — not part of this fix

## Context

- Architecture: `docs/architecture/<area>.md`
- Best practices: BP-XXX (if a specific BP applies)
- Related Linear: <issue refs>
- Blocked by: <issue ref> (if any)
```

## Examples

### Bug

```markdown
## What we're solving

When an SSE client reconnects after a brief disconnect, it currently
receives the entire item stream from the request start, leading to
duplicate items in the UI and noisy logs.

## Current behavior

`createSSEStream` does not honor the `Last-Event-ID` header or the
`starting_after` query param when re-establishing the connection. All
items emitted on the request are replayed regardless of what the client
already saw.

## Desired behavior

A reconnecting client provides its last seen sequence via either
`Last-Event-ID` or `starting_after`. The stream must skip every item
with `sequence_number <= last_seen` and resume from the next emitted
item. No item is delivered twice; no item is silently skipped.

## Key surfaces

- `createSSEStream` in `@flow-state-dev/engine` — accept resume cursor,
  filter items below it
- Items affected: every type with a `sequence_number` (all stream items)
- Architecture doc: `docs/architecture/streaming.md` (cursor format is
  `${requestId}:${sequence_number}`)

## Acceptance criteria

- [ ] Reconnecting with a valid `Last-Event-ID` skips already-seen items
- [ ] Reconnecting with `starting_after` query param does the same
- [ ] A reconnect with no cursor still delivers from the start
- [ ] Vitest integration test covers all three cases against a mock
      client
- [ ] `pnpm --filter @flow-state-dev/engine typecheck && pnpm --filter @flow-state-dev/engine test` passes

## Out of scope

- Cross-request resume (resuming after the original request ended) —
  that's FSD-XXX
- Client-side reconnect logic in `@flow-state-dev/client` — separate
  ticket

## Context

- Architecture: `docs/architecture/streaming.md`
- Best practices: BP-007 (file/export documentation)
```

### Enhancement

```markdown
## What we're solving

Capability authors currently have no way to declare a single named
context formatter that applies the same prefix to every emitted context
slot. They end up duplicating the prefix in each formatter, which drifts
across versions of the capability.

## Desired behavior

`defineCapability` accepts an optional top-level `contextPrefix` string.
When present, every context entry produced by the capability is prefixed
with that string at emission time. Existing capabilities without
`contextPrefix` behave unchanged.

## Key surfaces

- `defineCapability` in `@flow-state-dev/core` — accept the new option
- `DefinedCapability` type — surface the new option in its public type
- Context formatter resolution path — apply the prefix at the assembly
  point so existing formatters don't need to know about it
- Architecture doc: `docs/architecture/capabilities.md`

## Acceptance criteria

- [ ] `defineCapability({ contextPrefix: "[Workspace] ", ... })` prefixes
      every context slot with `[Workspace] `
- [ ] Capabilities without `contextPrefix` are byte-identical to before
- [ ] Vitest spec next to the source covers both cases
- [ ] `packages/core/README.md` `defineCapability` section documents
      the new option
- [ ] `apps/docs/docs/capabilities/<page>.md` reflects the option in
      its API reference
- [ ] `pnpm --filter @flow-state-dev/core typecheck && pnpm --filter @flow-state-dev/core test` passes

## Out of scope

- Per-slot prefix overrides — wait until a real use case appears
- Dynamic prefix (`(ctx) => string`) — same reasoning

## Context

- Architecture: `docs/architecture/capabilities.md`
- Best practices: BP-007 (doc-comment exports), BP-016 (no impact —
  contextPrefix isn't on a generator output schema)
```

## When NOT to use this template

- An issue large enough to need a full implementation spec → use `issue-spec`. The spec doc carries the detail; the issue body stays PM-shaped.
- An issue genuinely needing human judgment (architectural decision, design choice, external access) → keep it conversational; mark it `ready-for-human` (or your team's equivalent) rather than agent-ready.
- An incident or ops issue with no clear acceptance criteria → write a triage note instead; turn it into a brief once the shape is known.

## Why no file paths?

The original brief might be acted on days or weeks after it was written. By then, files may have moved as part of unrelated refactors. Naming a *type*, *block*, or *capability* survives those refactors; naming a *path* does not. The architecture doc named in "Context" is the durable anchor — it's renamed only when the contract changes, in which case the brief is stale anyway.
