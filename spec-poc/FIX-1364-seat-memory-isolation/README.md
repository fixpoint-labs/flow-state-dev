# FIX-1364 POCs

Throwaway. Never merges; closes with the spec PR. **Please don't review it as code.**

Two questions, two scripts:

| Script | Question | Verdict |
|---|---|---|
| `run.ts` | Is per-seat durable memory reachable by composition? | **SEPARABLE** — yes, one flag, no new primitive |
| `resources-bubble.ts` | Does `uses:` alone install a capability's resources? | **REDUNDANT** — yes, so the `resources` option was dropped |

```
pnpm tsx spec-poc/FIX-1364-seat-memory-isolation/run.ts
pnpm tsx spec-poc/FIX-1364-seat-memory-isolation/resources-bubble.ts
```

---

## 1. Is per-seat durable memory already reachable by composition?

## The question

`docs/architecture/workforce-agent-kind.md` **C4** names a gap:

> user-scoped memory is durable per *end user*, with no member or seat identity in it, so a
> multi-seat roster serving one person shares one memory

If that is unconditionally true, this issue's honesty half is "name it and file a ticket".
But core says `defineFlow({ isolateUserState: true })` supplies the default `flowIsolation`
for user-scoped resources that declare none, keyed on the **instance** id — and a seat *is*
a flow instance. Every one of memory's user-scoped resource factories declares no
`flowIsolation` of its own.

So the gap may be a **default** rather than a missing primitive. That changes what this
issue teaches, so it had to be run rather than argued.

## Run it

```
pnpm tsx spec-poc/FIX-1364-seat-memory-isolation/run.ts
```

## What it does

Two seats of one collection flow, one end user, one shared store. Writes a semantic fact
through seat A, reads through seat B.

The **control case** (`isolateUserState: false`) is what makes the result meaningful: if
both cases came back isolated, the harness would be proving nothing, and the verdict would
be worthless. A check that cannot fail has not verified anything (BP-003).

## Result

```
Case 1 — isolateUserState: true
  seat A (wrote) sees: [ 'the human prefers dark mode' ]
  seat B (other)  sees: []

Case 2 — isolateUserState: false   (control)
  seat A (wrote) sees: [ 'the human prefers dark mode' ]
  seat B (other)  sees: [ 'the human prefers dark mode' ]
```

**SEPARABLE.** Per-seat durable memory needs no new isolation primitive. C4's gap is real
as a *default* — user-scoped resources default to shared (BP-027) — not as a missing
capability.

Note what this does **not** show, because the spec leans on the distinction: `isolateUserState`
is a flag on the flow *definition*, so a roster is all-isolated or all-shared. Mixing (one
tier shared, another per seat) would need memory's resource factories to forward
`flowIsolation`, which they do not. That is the residual gap the spec files as a ticket.

## Incidental finding

`testFlow` cannot currently drive a **collection** flow. It seeds a session record carrying
`flowKind` but no `flowId` (`packages/testing/src/test-utilities/testFlow.ts`), so
`ownsRecord` reads it as a pre-ownership legacy row and refuses the run:

```
FlowInstanceBindingMismatchError: ... reason: "migration-required"
```

`run.ts` works around it by pre-seeding sessions that name their owning instance. Every
seat-level test of the agent kind will hit this. Carried into the spec's §12 as a follow-up
against the testing harness — not this issue's to fix.

---

## 2. Does `uses:` alone install a capability's resources?

`resources-bubble.ts`. Codex argued during review that a separate `resources` option is
redundant — capabilities contribute their declared resources to the generator, and
`defineFlow` merges every action block's declarations. That contradicts the memory README,
which teaches spreading `{...mem.sessionResources, ...mem.userResources}` onto `defineFlow`,
so it was run rather than decided from the comment.

A flow declaring `uses: [memoryCapability]` and **no** `resources:`:

```
Stores reachable with NO `resources:` on defineFlow: [ 'workingMemory', 'semanticMemory', 'episodicMemory' ]

VERDICT: REDUNDANT — `uses:` alone installs the capability's resources.
```

So the `resources` option was dropped from the spec's Decision 1, narrowing it from the shape
the Architect originally ratified. One nuance the probe does not cover: flow-level
declarations are prefetched while block-level ones load on the declaring block, so the option
would only come back if a concrete prefetch requirement appeared. None has.
