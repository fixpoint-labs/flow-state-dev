---
---

Internal (`@flow-state-dev/conductor`, private and unpublished): the observer
seam, and a local source behind it.

Conductor had one seam and needed two. `Dispatcher` abstracts *how work gets
done*; nothing abstracted *how the world is read*, so the read half of a tick
was GitHub by construction — `pollGitHub(client, …)` was the only path from the
world to `decide`. `Observer` is the mirror: `{ source, observe(request) }`,
returning the world snapshot, the signals since the cursor, the divergences, the
next cursor, and the facts the phase declared. Nothing GitHub-shaped is in it.
`src/github/` is now an implementation of it (`githubObserver`) with its
behaviour unchanged, and the tick — which does not exist yet — can be written
against the seam rather than retrofitted onto it later.

The second implementation reads a real git checkout. A branch's head is
`rev-parse`; whether it merged is `merge-base --is-ancestor`; whether it *can*
merge is a real trial merge with `merge-tree --write-tree`; guidance hashes are
`hash-object`, the same blob sha GitHub reports. Reviews, comments, and check
conclusions are files under `.conductor/local/` that a human or a real check run
wrote. This is not a second `testing/replay`: that harness is handed a world per
step and a dispatcher with scripted results, and nothing here is handed an
answer. An empty review inbox means nobody has reviewed the work.

Two things fell out of building it. `toObservedPr` moved from
`src/github/read-world.ts` to `src/driver/reconcile.ts`, beside the `ObservedPr`
it produces, because both sources persist the same projection; the old name is
re-exported from where it was. And `git merge-tree --write-tree` exits 1 both
for a genuine conflict and for a revision it cannot resolve, so exit code alone
reads an unresolvable ref as a conflict and would dispatch an agent to fix one
that does not exist — the two are told apart by whether git wrote a tree oid.

`World` is unchanged, and deliberately so. Its one remaining vendor lean is that
a submission is identified by a number, which `Signal` shares (`pullNumber`);
generalising one without the other would break signal-to-phase scoping, so it is
a single decision rather than two, and it is not one this change needed to make.

No public API surface changes beyond the new `@flow-state-dev/conductor/observe`
entry point, which exports types only.
