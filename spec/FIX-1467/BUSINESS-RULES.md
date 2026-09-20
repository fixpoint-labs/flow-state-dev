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
| BR-1 | A seat under an org reads a reference at or above its place in the tree, with no `references:` key | It gets the body of the file on disk as of this request — never a stored row | CI · red today (POC leg 2, green half) |
| BR-2 | The file on disk is edited and the process restarts | The next read returns the new body. No migration, no cache to bust | CI |
| BR-3 | The file on disk is edited **without** a restart | The next **request** returns the new body; a read already in flight does not. The file is read when the execution context is built — see [PLAN → how fresh a reference read is](PLAN.md#caching). The rule is *the file is the source*, not *the read is uncached* | CI · asserted per request, never as "immediately" |
| BR-4 | A seat declares `references:` naming a subset | It reaches that subset and no more. Naming one it could not already reach is a refusal, not a widening (BP-031) | CI |
| BR-5 | A seat declares `references: []` | It reaches no references. Present-and-empty is *restricted to nothing*, distinct from absent | CI |
| BR-6 | A reference ref matches no file | Refused at hire, naming the ref — a grant that resolves to nothing is a lockout wearing the face of a typo | CI |

## The team wall

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | A seat on team A reads a reference under `teams/B/` | Refused. Not an empty read, not a null body — the ref is not reachable from this seat at all | CI · **red today** (POC leg 2) |
| BR-9 | A worker-local reference under `teams/A/workers/ada/` is read by another seat on team A | Not reachable. The walk inherits downward only; a sibling's folder is not above anyone | CI |
| BR-10 | A reference must reach seats on more than one team | It is placed higher in the tree. Width comes from where the file sits, and from nothing else — there is no install-side override | CI · BR-7 is what makes this the only answer |

**Two rules were cut here in review round 1, both because nothing could exercise them.**

- **The old BR-10** said an app could install a deliberately wide slice on one kind and have it
  honoured. That contradicts BR-7: if the derived wall can be widened from the install side, the
  wall is optional again, which is the exact hole D2 exists to close. There was also no mechanism
  to widen *with* — S4 derives from tree position and an explicit `references:` may only narrow —
  so the rule promised a door that no surface opened. Width is now the tree's job, which is what
  BR-10 says instead. **The known limit is the one [D2](DECISIONS.md#d2) already names as its
  change-my-mind:** a document two *sibling* teams share and no parent should. The tree cannot
  express that, and this spec does not add an escape hatch for it — if that case turns out to be
  real, the tree is the wrong axis and that is a re-gate, not a setting.
- **The old BR-8** said a seat under `org/workers/<name>/` reaches an org reference. No such seat
  can exist: the roster reader passes over an org-level `workers/` in silence, and
  `read-resources-directory.ts:159-165` says so in as many words. The *documents* there do load and
  are minted `workers/<worker>/<name>` (`manifest.ts:484`) — so the path is real and only the seat
  is missing. A rule whose CI check has no production path to run against is a rule that passes by
  vacuum. Recorded as a gap in [PLAN → Follow-ups](PLAN.md#follow-ups); org-level seat support is
  not in this issue's scope.

## Writing, and the boundary with `resources/`

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | Any code path attempts to write a reference's content | Refused, whatever the frontmatter says. The install half seals every file in the folder and a document cannot unseal itself — so there is no key to forget and nothing an author can turn back on | CI · **red today** (POC leg 3) |
| BR-12 | A reference's file declares `writable:` in frontmatter, either value | Refused at load, naming the file. A document that asks for a pen in the folder that has none is a mistake, not a preference — and `writable: false` is refused too, because agreeing with the install half is still a second place the same fact lives. **Note:** `writable` passes through from frontmatter today, so this rule is a real change, not a restatement | CI |
| BR-13 | A `resources/` document is read and written by a granted seat | Exactly as it behaves today, byte for byte — seed once, the row is the source (BP-030) | Existing suite, unchanged |
| BR-14 | A `resources/` document is reached by a seat with no `resources:` key | Exactly as today: reachable. A `resources:` grant is **optional narrowing**, never a precondition for reach. This spec does not tighten the mutable path | Existing suite · **the regression that must not happen** · POC leg 4 pins it green |
| BR-15 | One basename is claimed by a `references/` file and a `resources/` file at the same level | Refused at load, naming both paths. Two spellings of one ref is how they overwrite each other | CI |

## Migration

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | A tree still has documents under `resources/*.md` that are handbooks | They keep working as they do today. No silent behaviour change from this spec alone | CI |
| BR-17 | A tree has both a `references/` and a `resources/` folder at one level | Both are read, by their own rules. That is the target state, not a transitional one | CI |
| BR-18 | A `references/` folder contains a directory, or a non-`.md` file | Reported the way the existing reader reports it — a directory is an error, a non-document is passed over | CI |
| BR-19 | A file moves into `references/` and its ref **already has a stored row** from when it was mutable | The file wins. Sealing stops new writes but does not evict the row that is already there, and that row otherwise shadows the file forever — so the move must clear it. Found in review round 1 (POC leg 5d); this is what makes S7 a migration rather than a `git mv` | CI · **the one that would ship silently** |

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
