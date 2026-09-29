# FIX-1635 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Each rule says who owns it and where it's checked. "Closure" means FIX-1636's goal check,
run over real HTTP against installed tarballs.

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | Every publishable package, packed and installed into an empty ESM project, imports | FIX-1431 | Leg a, a standing CI job FIX-1431 lands · the closure reuses it |
| ER-2 | DevTool cannot be published without its client assets, and serves them from an installed copy | FIX-1334 | Leg a, which FIX-1334 extends · the release build |
| ER-3 | A request id a caller supplies never reaches another user's request record or its items, on any path that writes it, attaches to its stream or resumes it. Reusing another user's id gets the caller its own request | FIX-1018 | Its HTTP case · host and SQLite tests · closure leg b |
| ER-4 | Two users in one tenant with the same request id never share a run-scoped workspace or its resources | FIX-1286 (consumes ER-3) | Its HTTP case · closure leg b |
| ER-5 | A session id reaches only its owner's session record; another user's id is not found | FIX-1022 | Its HTTP case · closure leg b |
| ER-6 | Only an allow-listed source is re-entered from public HTTP by retry, continue or resume | FIX-1021 | Its HTTP case · closure leg b |
| ER-7 | A session's stored flow never authorizes reading another flow's requests or items | FIX-1046 | Its HTTP case · closure leg b |
| ER-8 | A cross-flow dispatch admits the target exactly as ingress would, organization included | FIX-1328 | Its HTTP case · closure leg b |
| ER-9 | A schema-invalid resource write throws and leaves state as it was | FIX-1256 (shipped) | Closure re-runs its test |
| ER-10 | `writable: false` on a collection refuses every write to an existing instance, `create` with `replace` included, and `delete`. Creating a key that does not exist stays open | FIX-1261 with FIX-1510 (shipped) | Closure re-runs its tests |
| ER-11 | On a queue host, a delivery into an existing session runs the recipient under its concurrency policy and incarnation guard; what still can't be honoured is refused by name | FIX-1634 | Its HTTP case, real Redis · closure leg c |
| ER-12 | A non-streaming multi-step turn returns the text the streamed turn would | FIX-1628 | Its HTTP case · closure leg b |

## What no child may do

| # | Rule | Owner · checked at | Because |
|---|---|---|---|
| ER-13 | No Workforce (Layer 2) concept in core, engine, client or react. FIX-1634 is generic; its Workforce adopt child is filed after its Layer 1 shape merges | FIX-1634, the one child near it · its spec review | The owner's layer rule |
| ER-14 | No child reopens org-optional, or deletes a named refusal without restating the guarantee it protected | Every child · FIX-1634's spec names what FIX-1302's `external-dispatcher` refusal guarantees, since it narrows it; each PR review | FIX-1442 is settled; a deleted refusal trades a loud failure for a silent one |
| ER-15 | No child widens: Tier B leftovers, first-hour DX and kitchen-sink polish stay out. Something noticed outside the goal is filed normally, not under this epic | The epic coordinator · each child's PR review against the set table | The set is locked by the owner |
| ER-16 | Every fix lands a regression test that fails on the commit before the hole closed, and no test pins today's defect as a contract. A child named in ER-3 to ER-8, ER-11 or ER-12 lands it as its case in the shared HTTP suite: over HTTP, as the second user where there is one | Each child · its PR names the commit the case failed on | A test that can't fail proves nothing; a control proved at fix time needs no old commit rebuilt at closure |

## How the set is run

| # | Rule | Owner · checked at | Because |
|---|---|---|---|
| ER-17 | A direct-route worker reproduces on current `main` first, and records the result on its Linear issue: reproduces or not, on which commit. No reproduction: it closes with a regression test (ER-16) and the commit that closed the hole, not a rewrite | Each direct-route child · the Linear comment, before its PR opens | D2. The closure cites the record rather than re-deriving it |
| ER-18 | A child's Linear state is mirrored the moment it changes; its route comes from its label | The epic coordinator · every wake | The wake derives blocked-by and route from Linear |

## The closure

| # | The epic is done when | Proved by |
|---|---|---|
| ER-19 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met) is met on one `main` commit: leg a passes in its standing job and fails against the 0.1.1 tarball; the HTTP suite (legs b and c) passes against the installed tarballs; every finding is fixed and retested | FIX-1636's goal check |
| ER-20 | The authentication guide says a caller-chosen id is an address, not an ownership, and the architecture's request-id section no longer calls a request id a capability | FIX-1018's docs change ([DOCS.md](DOCS.md)) |
