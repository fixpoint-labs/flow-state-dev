# FIX-1435 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Nearly all of them say "as today", because a refactor promises
exactly that. They are listed so each has a check that would catch the regression. "Door A" is
the Markdown reader (both `resources/` and `references/`). "Door B" is the TypeScript module walk.

## Where the doors look

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A tree has a `resources/` folder at each of the four places: org, an org worker, a team, a team worker | Door A returns one document per `.md` and Door B one module per `.ts`, under the same refs as today | Existing suites · the new both-doors test |
| BR-2 | The both-doors test's tree is built | It comes from the list of places beside the walk, expanding each `*` with a fixture name. There is no hand-written list of paths (D1) | New both-doors test |
| BR-3 | A `resources/` folder sits somewhere that isn't a place: the root, a channel folder, a folder nested inside a worker | Neither door reads it, as today | New both-doors test, with decoys |
| BR-4 | The walk visits a place the list doesn't have, or the list has one the walk skips | The list-driven test fails, naming the slot (the second half only. The first half isn't caught, [D1](DECISIONS.md#d1)) | New both-doors test, with its control run in the PR |
| BR-5 | A folder named `resources` sits in a `workers/` level | It is a worker folder like any other, as today | Existing suites |

## What each door returns, unchanged

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | Door A reads a tree | Same documents, in the same order: org, org workers in directory order, then each team and its workers in directory order | Characterization test |
| BR-7 | Door B reads a tree | Same modules, sorted by path. Workers are visited in sorted order, so problems come in the same order as today | Characterization test |
| BR-8 | `org/`, a `workers/` level, a team, or a slot is symlinked or unreadable | Each door reports it with the same path, kind and wording as today. Door A records it as `unreadable-slot`, Door B as a flat message | Characterization test · existing suites |
| BR-9 | A worker folder is symlinked or unreadable | Door A names it by its folder name. Door B names it by its full path. Both are byte-identical to today | Existing assertions, unedited |
| BR-10 | A root is symlinked, missing, or spelled with a collapsing `..` | Both doors throw, as today | Existing suites |
| BR-11 | Door A reads `references/` | Same records carrying `filePath`, same wider refusal | Existing suites |
| BR-12 | A module and a document share a name, including across `resources/` and `references/` | Door B refuses the pair, naming both files, as today | Existing suites |
| BR-13 | `fsdev gen` lists where it searched | The same four patterns, in the same order, now read from beside the walk | Existing codegen suite |

## TypeScript detection

| # | When | Then | Proved by |
|---|---|---|---|
| BR-14 | Any of the three codegen doors meets an entry | `.ts` and `.tsx` are modules and nothing else is, from one definition | Existing suites · grep shows one definition |

## Failure taxonomy

Nothing new can fail. Every refusal stays collected, not thrown, in the door that collected it
before. Only the root still throws. A regression here is a change in output, and the
characterization test is where it shows.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): both doors ride one walk with the list of
places beside it. The both-doors test is built from that list and fails under its control. The
characterization test is green before and after. No existing assertion is edited.
