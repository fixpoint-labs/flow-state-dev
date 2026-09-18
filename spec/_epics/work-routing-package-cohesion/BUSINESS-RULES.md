# FIX-1407 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

At epic altitude the rules aren't behaviours of one feature; they're the constraints every child
spec and implementation must satisfy, and the place a cross-spec review checks. Each says who owns
it and where it's checked. ER-1 to ER-5 and ER-19 are the rows of the ownership matrix in
[DECISIONS.md](DECISIONS.md#who-owns-what).

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | Work for a team lives as a row on a **channel or org board** — `0..N` TaskCollections attached to a channel — and a seat claims it or is assigned it. Channel flow actions and `taskTools` are **two doors on one mutation surface** | FIX-1385 | FIX-1385's spec · the proof |
| ER-2 | A seat carries **one package format**, with two attachment modes: seat **always-on**, library **opt-in**. A tool, a skill and an instruction have one home between them, not two | FIX-1394, after POC ratify | FIX-1394's POC matrix · every child's spec review |
| ER-3 | Membership expand, author check, fan-out and DM find-or-create are answered by **one L2 query** over the shared Workforce map plus hire, `channelInstances` and open sessions | FIX-1405 | FIX-1405's two prove-pressure callers · FIX-817's and FIX-1415's spec review |
| ER-4 | Dispatch always passes `parentSessionId` and the child binds its parent **for life at mint**. Parent history reaches a child only through **opt-in tools**; the default payload is the brief — `goal` / `constraints` / `acceptance` / `links` | FIX-1408 (D4) — **shipped as a decision** | Every child's spec review |
| ER-5 | A board `assignee` is a **board-worker key**, not a Workforce seat; the two map by composition. `assignee` stays optional, and a registry board's "must be assigned" is discipline, not schema | FIX-1385 | FIX-1385's spec · FIX-1430's wiring |

**On ER-2**: *after POC ratify* is the rule, not a hedge. FIX-1394 does not cut a ship ticket from
exploration alone, so no other child may write against a package schema before that ratify lands —
the schema itself is on the [Still open](DECISIONS.md#open) list.

**On ER-4**: it is discharged by a decision rather than by a check, because FIX-1408 closed
without an implementation PR. The first child to build over the wire is where it first gets tested,
and its unclosed walls are [Open 2](DECISIONS.md#open).

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-6 | No child invents **Agent, Channel, Team, MessageBoard, TeamFlow, ChannelAdmin or SessionBoard as an L1 package type**, and none revives `materializeAgent` or an `AgentRegistry` | D3. Agent is an opinionated default *kind*; the rest are L2 opinion or nothing |
| ER-7 | No child ships `team.*` (or other) wildcards before the inventory lands, and none blocks the channels convention on them | D5. Wildcards are a later **caller** of inventory, not part of the first ship |
| ER-8 | No child ships the package collapse from FIX-1394 alone, without a POC ratify | The whole delivery posture of that ticket: POC matrix → Architect/PM ratify → then cut ship tickets |
| ER-9 | No child dumps a parent's full transcript, or a parent's private seat history, into a child by default | D4. Channel transcript passes only when both are on that channel |
| ER-10 | No child makes boards the mint door for sessions, DMs, posts or sub-agents, and no child introduces assignable-channel routing or Project-as-required | D1, D3. Conversation stays off the board |
| ER-11 | No child expands the L1 `TaskStatus` enum. Queue columns — idle, ready-for-review, waiting-on-you — are **L2 views** over existing status plus claim, assignee, park reason and seat idle | A second hold status was already refused. Seat idle is a runtime view, not a status |
| ER-12 | No child builds a second `WorkerRegistry`, a mega-loader, a mega-bus or a parallel index of truth, and none rebuilds **Graft** for membership or DM lookup | D5. One scan fills one shared map |
| ER-13 | No child closes an item on the Architect's **Still open** list without the owner | Exact package schema · reuse-vs-create · inventory helper-vs-resource · nested board cascade timing · how many POCs before a ship cut. Exploration may lean; leaning is not closing |
| ER-14 | **No W4 *ship* PR merges while W3 ([FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351)) has open children.** Today: FIX-1377, FIX-1416, FIX-1435, FIX-1441. Filing, specs and POCs run now | D2. The fence is on merge, not on work. Checked by the epic wake before any child's impl PR merges |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-15 | A cross-cutting question a child hits is commented **up** on the epic PR, not decided locally | [DECISIONS.md](DECISIONS.md) is the single place. A local answer is a second authority — and five walls are live |
| ER-16 | A child's Linear state is mirrored the moment it changes | The epic wake derives blocked-by from Linear. **Already failing:** FIX-1377 and FIX-1416 read *In Spec Review* in Linear while both spec PRs carry the `spec approved` label and are closed |
| ER-17 | Every child's route reads *spec* by default; only a `Bug` label re-routes it | Fail-closed routing. All seven children carry `Design` + `Feature`, so all seven spec |
| ER-18 | A child depending on FIX-1377 or FIX-1416 writes against their **approved specs** and says so by name; neither has landed | FIX-1377 puts the team layer on the `WorkerConfig` contract as its own key, composed framework-default → team → seat. FIX-1416 makes the blocks scan the tool catalog behind the `tools:` fence, with a worker-colocated folder joining the seat's declared list. A child that writes as if either exists is writing against unbuilt code |
| ER-19 | **OWNER-LESS.** The project's **PR-5** — a new surface uses the settled Layer 2 name, never the superseded one — is assigned to **this epic** and to no child in it | Carried from the project spec ([#1818](https://github.com/fixpoint-labs/flow-state-dev/pull/1818)). Recorded as a gap rather than dropped ([Open 3](DECISIONS.md#open)) |

## The proof

| # | The epic's first cut is done when | Proved by |
|---|---|---|
| ER-20 | A piece of work filed on a **channel or org board** wakes a seat that runs it, and a coordinator seat assigns work to **team** seats — on the real path, with the seats and channels declared in files | **Unowned today.** FIX-1430 is the only candidate; adopting it is [sign-off item 2](SPEC.md#sign-off) |
| ER-21 | The queue a coordinator sees is a **view** over existing task state and seat idle, with no new status and no new L1 type | FIX-1430's goal check · ER-11 |
| ER-22 | The docs teach work routing as something a team gets by attaching a board to a channel, not something it builds — and teach `assignee` and *seat* as two different things | The epic's docs pass · ER-5 |

**ER-20 is the rule to read twice.** The epic has a behavioural exit gate and, until the gate
ratifies FIX-1430 into the role, nothing in the set runs it. An epic that wraps on ER-1, ER-2 and
ER-3 shipping would be claiming routing works rather than having seen it.
