# FIX-1467 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

The cases, written as rules. Each says what a person or the system does and what happens.
The *proved by* column is the check the plan runs. A human reviews this page; the plan turns
it into work.

Every row marked **red today** has a failing check in
[`spec-poc/FIX-1467-references-vs-resources/`](../../spec-poc/FIX-1467-references-vs-resources/)
already, so the implementer inherits the red state rather than having to construct one.

## Reading a reference

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A seat under an org reads a reference at or above its place in the tree, with no `references:` key | It gets the current body of the file on disk | CI · red today (POC leg 2, green half) |
| BR-2 | The file on disk is edited and the process restarts | The next read returns the new body. No migration, no cache to bust | CI |
| BR-3 | The file on disk is edited **without** a restart | Unspecified by this spec; whatever the read path's own caching does. The rule is *the file is the source*, not *the read is uncached* | CI · asserted as "after restart", never as "immediately" |
| BR-4 | A seat declares `references:` naming a subset | It reaches that subset and no more. Naming one it could not already reach is a refusal, not a widening (BP-031) | CI |
| BR-5 | A seat declares `references: []` | It reaches no references. Present-and-empty is *restricted to nothing*, distinct from absent | CI |
| BR-6 | A reference ref matches no file | Refused at hire, naming the ref — a grant that resolves to nothing is a lockout wearing the face of a typo | CI |

## The team wall

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | A seat on team A reads a reference under `teams/B/` | Refused. Not an empty read, not a null body — the ref is not reachable from this seat at all | CI · **red today** (POC leg 2) |
| BR-8 | A seat under `org/workers/<name>/` reads an org reference | Reaches it. Inherit runs down the tree, and a worker under `org/` is under the org | CI |
| BR-9 | A worker-local reference under `teams/A/workers/ada/` is read by another seat on team A | Not reachable. The walk inherits downward only; a sibling's folder is not above anyone | CI |
| BR-10 | The app installs a deliberately wide slice on one kind | Honoured. An app may still widen its own kind explicitly; what changes is that it no longer has to narrow by hand | CI · the second path (BP-035) |

## Writing, and the boundary with `resources/`

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | Any code path attempts to write a reference's content | Refused, whatever the frontmatter says. A reference has no write path to turn on | CI · **red today** (POC leg 3) |
| BR-12 | A reference's file declares `writable: true` in frontmatter | Refused at load, naming the file. A document that asks for a pen in the folder that has none is a mistake, not a preference | CI |
| BR-13 | A `resources/` document is read and written by a granted seat | Exactly as it behaves today, byte for byte — seed once, the row is the source (BP-030) | Existing suite, unchanged |
| BR-14 | A `resources/` document is reached by a seat with no `resources:` key | Exactly as today: reachable. This spec does not tighten the mutable path | Existing suite · **the regression that must not happen** |
| BR-15 | One basename is claimed by a `references/` file and a `resources/` file at the same level | Refused at load, naming both paths. Two spellings of one ref is how they overwrite each other | CI |

## Migration

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | A tree still has documents under `resources/*.md` that are handbooks | They keep working as they do today. No silent behaviour change from this spec alone | CI |
| BR-17 | A tree has both a `references/` and a `resources/` folder at one level | Both are read, by their own rules. That is the target state, not a transitional one | CI |
| BR-18 | A `references/` folder contains a directory, or a non-`.md` file | Reported the way the existing reader reports it — a directory is an error, a non-document is passed over | CI |

## Failure taxonomy

Everything that can be wrong about a *declaration* is fatal at load or hire: an unmatched ref
(BR-6), a `writable: true` reference (BR-12), a basename claimed twice (BR-15). That matches
the existing convention, where `hireWorkforce` throws and `readResourcesDirectory` collects.
Everything about a *read* degrades: a file that disappears between boot and read is a null
body, not a crash. Nothing retries.

## Acceptance criteria this issue owns

Two, and they are the two red legs:

1. An ordinary seat, hired with no grant list at all, reads its org and team references and
   **cannot** read a sibling team's — with no filter written by the app.
2. A reference's body, read after something has tried to write it and after a restart, is the
   body in the file. The POC's `DEFACED` case goes green.

Both are goal checks on the real path — loader, `hireWorkforce`, live execution context — not
unit assertions on a helper. The POC already runs them; it runs them red.
