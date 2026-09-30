# FIX-1277 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

What was considered, what was chosen, and what each choice locks in. One decision and one open
question are the sign-off surface.

## The tree

```mermaid
flowchart TD
  I["FIX-1277"] --> D1["D1 · the rule lives in contracts<br/>public helper, reached through core/helpers"]
  D1 -.->|"rejected"| X1["stores import it from the engine<br/>needs the engine runtime in every store"]
  I --> O1["Open · SQL statements keep their own compare<br/>recommended"]
  O1 -.->|"not recommended"| X2["decide in code, then write<br/>changes behaviour under concurrent writes"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · The rule moves to `@flow-state-dev/contracts` and becomes a public helper there

| | |
|---|---|
| **Instead of** | Letting the two SQL stores import it from `@flow-state-dev/engine` at runtime |
| **Because** | A store may import the engine for types only; that is a package-boundary rule, and lifting it would load the whole engine runtime into every store. Contracts is already under every store through core, has no dependencies, and the rule needs none (tenet 2: sharpen what exists, add nothing beside it) |
| **Locks in** | The rule is public API of a published package. Changing what it accepts becomes a contracts release, and an outside adapter that imported it gets the change on upgrade. The architect's fence for this desk leaned this way; this card records the call |

![D1, where the version rule lives. Chosen: contracts, a public helper. Instead of: the engine, imported at runtime by the stores. It comes down to what a store has to load: nothing new with contracts, the whole engine runtime otherwise. The price is visibility: contracts makes the rule public, the engine keeps it internal. Locks in the rule as public API of a published package. Flips if the rule ever needs something contracts can't depend on](figures/d1-contracts-home.svg)

It comes down to what a store has to load: the engine route pulls its whole runtime into every store.

**What would change my mind:** the rule needing something contracts can't depend on, such as a
core type or the deep-copy helper. It doesn't today: the copy stays in the engine
([Decided, not asked](#decided-not-asked)).

<a name="open"></a>
## Open · Should the SQL write statements keep their own compare?

**Keep the SQL compare, or move every decision into code?** · *recommended: keep it*

**In plain terms:** the Postgres and SQLite stores check the version and write the row in one
database statement. That is what makes the check safe when two writers race. Taking the check
out of the statement means reading the row, locking it, deciding in code, then writing. That
changes how a store behaves under concurrent writes, not only where the rule is written.

**The trade-off:** keeping it leaves one second copy, the compare inside each SQL statement.
Moving it removes that copy, but every SQL write then takes a lock and a transaction, and every
way of plugging in a connection must support them, including the raw connection a user can pass
the Postgres store today. Anyone running Postgres or SQLite under load would feel it.

**My recommendation:** keep it, and ship the smaller goal. The brief is behaviour-preserving, and
this is a behaviour change with its own cost to measure. The shared suite runs every case against
both SQL stores, so a drifted compare fails in CI for any case it covers.

**What would change my mind:** wanting a lock-based write path on its own merits, say for a
database with no conditional write. Then it is its own issue with its own concurrency spec.

**If I'm wrong:** the SQL compare drifts in a case the suite doesn't cover, and one store
resurrects a deleted resource or accepts a stale write: the bug class this issue exists to
prevent, confined to the compare.

![Open question: should the SQL write statements keep their own compare? Recommended: keep the compare in the statement. The other option: read, lock, decide in code, then write. It comes down to behaviour under concurrent writes: unchanged with the recommendation, changed with the other. The price is where drift can hide: the recommendation leaves the SQL compare as a second statement of the rule. Locks in the SQL compare as a restatement kept honest by the shared suite. Flips if a lock-based write path is wanted on its own merits](figures/open-sql-compare.svg)

It comes down to concurrent writes: moving the compare changes how every SQL write behaves.

## Decided, not asked

- **Which semantics win: none had to.** The [census](poc/copy-census/check.mjs) finds every
  copy identical. The one difference, the engine deep-copying a conflict's value, is intentional.
  Nothing observable changes.
- **The conflict report moves too**, not only the three guards the issue names: it restates the
  same "a deleted row reports no value" rule.
- **The deep copy stays in the engine**, before it calls the shared builder. Only the in-memory
  store needs it, and it needs a core helper contracts can't import.
- **The in-code compare (`checkWriteVersion`) stays in the engine.** It has one copy already.
- **The version type moves with the rule**; the engine re-exports it and the row and conflict
  types under their current names.
- **Stores import through `@flow-state-dev/core/helpers`**, the path other contracts helpers
  take. No package gains a dependency.
- **One `patch` changeset** for contracts and core: a published package gains exports.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Keep the three copies; rely on the conformance suite | The status quo. The suite catches only the cases it lists, and every edit still needs remembering three times |
| A new shared package for store helpers | A new package for four functions, when a zero-dependency layer already sits under every store |
| Generate the SQL compare from the shared rule | The two stores' SQL dialects and parameter styles differ, and SQL in contracts breaks what contracts is for. It would make the compare harder to read, not safer |

## Settled

- **The three copies have not drifted.** **CONFIRMED** by
  [`poc/copy-census/check.mjs`](poc/copy-census/check.mjs) on `origin/main` at `67a3bb9b3`: three
  defining files, all four roles identical after stripping comments; its control (a planted copy
  and a one-character drift) reports both.

## How it got here

- **Draft** — framed as removing duplication without changing behaviour; the rule moves to
  contracts and every store calls it; the compare inside the SQL statements stays, and whether it
  should is the one open question. One PR.
