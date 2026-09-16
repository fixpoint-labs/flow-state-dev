# FIX-1351 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

At epic altitude the rules aren't behaviours of one feature; they're the constraints every child
spec and implementation must satisfy, and the place a cross-spec review checks. Each says who
owns it and where it's checked. ER-1 to ER-7 are the rows of the ownership matrix in
[DECISIONS.md](DECISIONS.md#who-owns-what).

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | Path level is scope: `org/<slot>/` is shared across teams, `teams/<teamId>/<slot>/` belongs to one, and both carry the same slots | FIX-1356 defines · 1354 consumes · 1352 consumes the **team door only** | Each reader's tests · every child's spec review |
| ER-2 | One ChannelFlow kind means one instance; a channel is a **named session** on it, holding its own members and transcript | FIX-1311 | FIX-1311's binder tests · the lab |
| ER-3 | A `CHANNEL.md` declares a channel the way a `WORKER.md` declares a seat: `flow:` names the kind, omitting it selects the built-in, and a misspelled one fails loudly | FIX-1352 | FIX-1352's reader tests |
| ER-4 | A key the convention **consumes** is stripped from the declared bag; a key it **derives** is refused — as a set, applied after any allowlisted passthrough | FIX-1354 defines · 1352, 1356, 1368, 1388 consume | Every child's spec review |
| ER-5 | Seats stay `WORKER.md`. A custom kind is a flow factory, never a richer folder, and the framework never runtime-imports a seat's TypeScript | FIX-1342 | Shipped — [#1712](https://github.com/fixpoint-labs/flow-state-dev/pull/1712) |
| ER-6 | One boot scan produces one `{ kinds }` map, with `workforce/blocks/` beside it; a document never defines a kind | FIX-1357 | FIX-1357's spec · FIX-1342's fence |
| ER-7 | Hire invokes the flow with a config the kind admits — the `skills` bag from the seat register plus one always-present extension placeholder | FIX-1367 | FIX-1367's **non-agent Proof**, which is the contract gate |

**On ER-1**: the rule is the lock, and it is half built. Resources and skills read `org/`; the
shipped channels reader walks `teams/` only, so `org/channels/` is declarable and unread. That is
a named gap with no owner, not a retraction — [D3](DECISIONS.md#d3) and
[Open 5](DECISIONS.md#open). No child closes it by widening a merged reader on its own.

**On ER-7**: empty or unused is fine; the *absent door* is not. A seat that mints and is handed
nothing it declared is what makes "a seat works" dishonest, and an agent E2E does not stand in
for the check.

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-8 | No child invents a `MessageBoard`, `Channel` or `Team` **L1 package type** | D1. The concepts ship as L2 opinion or not at all |
| ER-9 | No child mints a second kind-registration path for its own kind | D6. Channel kinds and worker kinds share one door, invented once |
| ER-10 | No child builds a parameterised slot reader that swallows every convention, and no child conflates the Markdown walk with TypeScript module discovery | Answered *no* by FIX-1354 §3; carried into FIX-1389's own invent-kill |
| ER-11 | No child copies the channels-specific `system:` key or its either-source rule | They exist because channels have two declaration sources and a deletion guarantee. A convention with one source needs neither, and adding them for symmetry is cargo cult |
| ER-12 | No child pulls the Collab roster ([FIX-1341](https://linear.app/fixpoint-labs/issue/FIX-1341)), MCP ([FIX-1333](https://linear.app/fixpoint-labs/issue/FIX-1333)), or brief / housekeeper / retirement / CAS into this epic's scope | D5. Held, recorded, not scheduled |
| ER-13 | No child widens the shipped `read-workforce-directory` reader for `org/workers/`, and none teaches that door in user-facing docs until a reader exists | D7. A documented door that reports nothing teaches a rule we are about to contradict |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-14 | A cross-cutting question a child hits is commented **up** on the epic PR, not decided locally | [DECISIONS.md](DECISIONS.md) is the single place. A local answer is a second authority |
| ER-15 | Each convention earns a **non-lab consumer** before the lab lands, or that is the signal it was built too early | The set was approved on this check. Skills is owed one by FIX-1367; resources has none, which makes it the most exposed |
| ER-16 | Every child's route reads *spec* by default; only a `Bug` label re-routes it, and an unlabelled issue's route stays unset rather than guessed | Fail-closed routing. FIX-1358 still carries no Kind label; it opened a spec on the default route and the label never arrived, which is flagged on the epic PR rather than read as a settled one |
| ER-17 | A child's Linear state is mirrored the moment it changes | The epic wake derives blocked-by from Linear; a stale child blocks its dependants whatever its PRs say |
| ER-18 | Docs land in the **Workforce** section, not Orchestration, and behind the reader they describe | The IA moved in [#1743](https://github.com/fixpoint-labs/flow-state-dev/pull/1743); teaching ahead of a reader is ER-13's failure in another surface |

## The proof

| # | The epic is done when | Proved by |
|---|---|---|
| ER-19 | A thin pentest lab declares a channel, a resource and a skill **in files**, hires the seats they belong to, and runs multi-seat on the real path | FIX-1355's goal check, real model |
| ER-20 | A post reaches a channel's members and the transcript reads as one clean conversation | FIX-1355's goal check · ER-2 |
| ER-21 | A hired seat receives the skills its files declared | FIX-1367's non-agent Proof, then FIX-1355 end to end |
| ER-22 | The docs teach the tree — `org/` and `teams/<teamId>/` with the same slots — as something an author writes, not something the framework has, with **`org/channels/` drawn as a named gap** for as long as nothing reads it (ER-18, ER-1) | FIX-1358's atlas teach and the epic's docs pass |
