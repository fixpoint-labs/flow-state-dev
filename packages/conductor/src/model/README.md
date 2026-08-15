# model

Conductor's vocabulary. Every other directory is written in terms of what is declared
here: the phases work moves through, the gates it waits on, the signals the world
reports, the actions those reduce to, the snapshot they are reduced against, and the
resource collections all of it is stored in.

Declarations and pure types only — no I/O, and nothing imported from `engine`.

| File | What it declares |
|---|---|
| `phases.ts` | the phase and gate table for an issue and for an epic, plus the world facts each gate says it reads |
| `signals.ts` | every signal conductor responds to — the complete surface it reacts to at all |
| `actions.ts` | what `decide` returns: a dispatch to a coding harness, or a write to the ledger |
| `world.ts` | the snapshot a gate predicate reads, and the review helpers over it (*does an approval stand right now?*) |
| `entities.ts` | the durable records, as resource collections, and the scope each one lives at |

Three kinds of thing are kept deliberately apart. A **phase** is stored on the entity. A
**gate** is never stored — it is derived from a snapshot on every tick. A **signal** is
transient. The package [README](../../README.md) carries the table and why the separation
earns its keep.

## Before you add a field

> **Structured state is exactly what `decide` reads. Everything else is content.**

An entity is a resource and uses both halves: `stateSchema` holds the structured fields
the driver reduces over, and resource content holds the prose — a spec document, a
retrospective — which `decide` never touches. The moment a phase, a gate, a round count,
or a review state drifts into prose, reading it takes a model, and the driver stops being
deterministic.
