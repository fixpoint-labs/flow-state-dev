# FIX-1635 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Each rule says who owns it and where it's checked. "Closure" means FIX-1636's goal check,
run over real HTTP against installed tarballs.

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | Every publishable package, packed and installed into an empty ESM project, imports | FIX-1431 | Closure leg a · CI's extension check |
| ER-2 | DevTool cannot be published without its client assets, and serves them from an installed copy | FIX-1334 | Closure leg a · the release build |
| ER-3 | A request id a caller supplies never reaches another user's request record or its items, on any path that writes one | FIX-1018 | Closure leg b · host and SQLite tests |
| ER-4 | Two users in one tenant with the same request id never share a run-scoped workspace or its resources | FIX-1286 (consumes ER-3) | Closure leg b |
| ER-5 | A session id reaches only its owner's session record; another user's id is not found | FIX-1022 | Closure leg b |
| ER-6 | Only an allow-listed source is re-entered from public HTTP by retry, continue or resume | FIX-1021 | Closure leg b |
| ER-7 | A session's stored flow never authorizes reading another flow's requests or items | FIX-1046 | Closure leg b |
| ER-8 | A cross-flow dispatch admits the target exactly as ingress would, organization included | FIX-1328 | Closure leg b |
| ER-9 | A schema-invalid resource write throws and leaves state as it was | FIX-1256 (shipped) | Closure re-runs its test |
| ER-10 | `writable: false` on a collection refuses every write-shaped path, `create` with `replace` and `delete` included | FIX-1261 with FIX-1510 (shipped) | Closure re-runs its tests |
| ER-11 | On a queue host, a delivery into an existing session runs the recipient under its concurrency policy and incarnation guard; what still can't be honoured is refused by name | FIX-1634 | Closure leg c |
| ER-12 | A non-streaming multi-step turn returns the text the streamed turn would | FIX-1628 | FIX-1628's test · closure re-run |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-13 | No Workforce (Layer 2) concept in core, engine, client or react. FIX-1634 is generic; its Workforce adopt child is filed after its Layer 1 shape merges | The owner's layer rule |
| ER-14 | No child reopens org-optional, or deletes a named refusal without restating the guarantee it protected | FIX-1442 is settled; a deleted refusal trades a loud failure for a silent one |
| ER-15 | No child widens: Tier B leftovers, first-hour DX and kitchen-sink polish stay out. Something noticed outside the goal is filed normally, not under this epic | The set is locked by the owner |
| ER-16 | No child pins today's defect as a contract in a test, and every fix lands a regression test that fails on the commit before the hole closed | A test that can't fail proves nothing |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-17 | A direct-route worker reproduces on current `main` first. No reproduction: it closes with a regression test (ER-16) and the commit that closed the hole, not a rewrite | D2 |
| ER-18 | FIX-1018 merges before FIX-1286 and FIX-1634 implement; their specs may start now | D3 |
| ER-19 | A child's Linear state is mirrored the moment it changes; its route comes from its label | The wake derives blocked-by and route from Linear |

## The closure

| # | The epic is done when | Proved by |
|---|---|---|
| ER-20 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met) is met: legs a, b and c pass on one `main` commit, each fails under its control, and every finding is fixed and retested | FIX-1636's goal check |
| ER-21 | The authentication guide says a caller-chosen id is an address, not an ownership | FIX-1018's docs change ([DOCS.md](DOCS.md)) |
