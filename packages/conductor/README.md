# @flow-state-dev/conductor

Development orchestration built on FSD. Conductor runs a software development
process: it drives a work item from problem through spec, review, implementation,
and PR feedback, dispatching the actual coding to a vendor harness and pausing
only where a human decision is genuinely required.

The process it encodes is not new — it is the one already written down in
`docs/contributing/orchestration.md`. Conductor does not invent it. Conductor
**executes it in code instead of interpreting it in a prompt.**

> **Status: M0.** This package currently ships the entity model and the pure
> driver. The tick, the GitHub connector, the dispatcher seam, and the CLI board
> land with M1.

## The shape

```
observed + fresh ──reconcile()──▶ Signal[] ──decide() per signal──▶ Action[] ──▶ execute
```

Three kinds of thing, kept deliberately separate:

| | What it is | Where it lives |
|---|---|---|
| **Phase** | where the work *is* (`SPEC`, `IMPLEMENTATION`) | stored on the entity; changed only by an `enterPhase` action |
| **Gate** | what the work is *waiting on* (`awaiting_ci`) | **never stored** — derived from a world snapshot every tick |
| **Signal** | what the world *reported* | transient; recorded in the ledger as it is reduced |

## The invariant

> **Every transition is reproducible from the ledger.**

A model may sit anywhere *upstream* of a signal. Classifying a human comment
into "this is feedback" versus "this is a question" is real judgment and belongs
to a model — its output is recorded as a signal, so a wrong call produces a
wrong-but-valid transition that is visible and replayable.

A model inside `decide` would produce a different transition each run from
identical state: unauditable, untestable, and the exact failure this design
exists to remove. The claim is not that judgment is unwelcome. It is that
**judgment must be recorded before it is acted on.**

## Why gates are derived, not stored

An earlier attempt at this system kept its progression in a second place
alongside the board, with no rule for who won. The two drifted, and a cold
restart between two gates looped forever.

Deriving is the fix. A gate is a pure predicate over a snapshot, so killing the
process while an entity waits on one loses nothing — the next tick re-derives
the same gate from the same world. There is no remembered gate to lose.

```ts
import { decide, deriveGate } from "@flow-state-dev/conductor";

const entity = { id: "FIX-1", kind: "issue", phase: "IMPLEMENTATION" } as const;

deriveGate(entity, world);
// → "awaiting_ci"

decide(entity, { kind: "ci_concluded", conclusion: "failure", sha, entityId: "FIX-1", at }, world);
// → [{ kind: "addressFeedback", entityId: "FIX-1", because: "CI failed on …" }]
```

## Entities are resources

Every entity is a resource collection, and every entity field lives in **resource
state**. Scope state is for in-process state management that persists only for
durability; conductor stores no entity data there.

Each entity uses both halves a resource already gives you:

- **`stateSchema` → `ResourceStateStore`** — the structured fields. This is the
  reducer's read set and nothing else.
- **content → `ContentStore`** — the prose: a spec document, a review body, a
  retrospective. Never read by `decide`.

> **Structured state is exactly what `decide` reads. Everything else is content.**

That split is what keeps the driver honest. `decide` is exhaustively testable
*because* it reduces over structured fields. The moment a phase, a gate, a round
count, or a review state drifts into prose, the reducer needs a model to read it
and the determinism claim collapses.

## Gates declare what they read

A gate asks a question about the world, and the world lives in GitHub — which is
in tension with `decide` being pure. The resolution is that the tick materializes
the answer first: by the time a predicate runs, everything it needs is plain data.

```ts
{
  name: "awaiting_ci",
  reads: ["pr.state", "pr.checkRuns"],       // fetched during read-world
  appliesWhen: (w) => implPr(w)?.state === "open",
  satisfiedBy: (w) => implPr(w)?.checks === "success",
}
```

This is the framework's own `uses`/capability shape — declare the dependency, get
it injected — not a new mechanism. Two consequences, both accepted: the tick may
over-fetch, and a phase cannot gate on a fact it did not declare.

## Reconciliation

Conductor keeps a copy of every PR fact it has seen. The copy is an asset: it is
the only thing a dropped event can be detected against.

A comment arrives for a PR conductor never saw opened. Without a copy that is
simply lost. With one it is a divergence — which is how conductor knows to
backdate the missed `pr_opened` and reduce it *before* the comment that revealed
the gap.

Two rules separate a cache from a second authority:

- **GitHub always wins.** Reconciliation never walks a PR backwards. A copy that
  says merged against a read that says open means the read is stale; the
  divergence is recorded and no signal is produced.
- **No new signal kinds.** Reconciliation re-emits the ordinary vocabulary with
  `synthesized: true` and a backdated `at`, so a replayed history and a live one
  reduce identically.

## What conductor never does

It never merges. Three human gates exist — the epic objective, each spec, and
every merge — and everything between them moves without asking.

## Development

```bash
pnpm --filter @flow-state-dev/conductor test
pnpm --filter @flow-state-dev/conductor typecheck
```
