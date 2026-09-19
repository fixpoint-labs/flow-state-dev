# FIX-1407 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

Not behaviours of one feature — the constraints every child spec and implementation must satisfy,
and what a cross-spec review checks. Numbers are stable ids, not an order. ER-1 to ER-5 and ER-19
are the rows of the ownership matrix in [DECISIONS.md](DECISIONS.md#who-owns-what).

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | Work for a team lives as a row on a **channel or org board** — `0..N` TaskCollections on a channel — and a seat claims it or is assigned it. Channel actions and `taskTools` are **two doors on one mutation surface** | FIX-1385 | FIX-1385's spec · the proof |
| ER-2 | A seat carries **one package format**, two attachment modes: seat **always-on**, library **opt-in**. A tool, a skill and an instruction have one home between them | FIX-1394, after POC ratify | FIX-1394's POC matrix · the proof, which may not invent a third shape |
| ER-3 | Inventory is **two layers**: a **declared roster** composed at read time from the existing readers, and the **live org resource** ChannelFlow updates as seats and channels open. Membership, author check, fan-out and DM find-or-create are answered by the live layer **at inventory level** — who exists and is open, for discovery, fan-out and DM find-or-create; the declared layer answers what the tree says exists. The live resource **does not own or mirror a channel's session-local `members`, nor its post-refusal fence** — that stays ChannelFlow-on-channel | FIX-1405 | FIX-1405's two prove-pressure callers · FIX-817's and FIX-1415's spec review, from outside the set |
| ER-4 | Dispatch always passes `parentSessionId`; the child binds its parent **for life at mint**. Parent history reaches a child only by **opt-in tools**; the default payload is the brief — `goal` / `constraints` / `acceptance` / `links`. **Linked is not nested**: no child reads this as reviving the substrate FIX-1440 removed | FIX-1408 (D4) — **shipped as a decision** | Every child's spec review |
| ER-5 | A board `assignee` is a **board-worker key**, not a Workforce seat; the two map by composition. `assignee` stays optional, and a registry board's "must be assigned" is discipline, not schema | FIX-1385 | FIX-1385's spec · FIX-1430's wiring |

ER-2's *after POC ratify* is the rule, not a hedge — no child writes against a package schema
before it. ER-3's declared layer does not substitute for the live one; its **public export on
`@flow-state-dev/workforce` was approved at the objective gate on 2026-09-19**, so FIX-1405
implementation now waits on its own spec and nothing else. ER-4 is
discharged by a decision rather than a check, so the first child to build over the wire is where it
first gets tested.

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-6 | No **Agent, Channel, Team, MessageBoard, TeamFlow, ChannelAdmin or SessionBoard as an L1 package type**; no revived `materializeAgent` or `AgentRegistry` | D3. Agent is an opinionated default *kind*; the rest are L2 opinion or nothing |
| ER-7 | No `team.*` (or other) wildcards before the inventory lands, and none blocking the channels convention | D5. Wildcards call the live layer later; they are not first ship |
| ER-8 | No shipping the package collapse from FIX-1394's exploration alone, without a ratify | That ticket's posture: POC matrix → ratify → then cut ship tickets |
| ER-9 | No dumping a parent's full transcript, or its private seat history, into a child by default | D4. Channel transcript passes only when both are on that channel |
| ER-10 | Boards are not the mint door for sessions, DMs, posts or sub-agents. No assignable-channel routing, no Project-as-required | D1, D3. Conversation stays off the board |
| ER-11 | No expanding the L1 `TaskStatus` enum. Queue columns — idle, ready-for-review, waiting-on-you — are **L2 views** over status plus claim, assignee, park reason and seat idle | A second hold status was already refused. Seat idle is a view, not a status |
| ER-12 | No second `WorkerRegistry`, mega-loader, mega-bus or parallel index of truth; no Graft rebuild for membership or DM lookup. **Compose is not a registry** — ER-3's declared layer derives per read, registers nothing, and may not stand in for the live resource. **No relocating ChannelFlow's post fence onto the org resource, and no second authoritative copy of a channel's membership** | D5. One derivation over the readers that exist; one live resource for what is open. Two authoritative copies of membership is the incoherence, not the fix |
| <a name="er-13"></a>ER-13 | No closing an item on the Architect's **Still open** list without the owner: exact package schema · reuse-vs-create · nested cascade timing · how many POCs before a ship cut. Exploration may lean; leaning is not closing | *Inventory helper-vs-resource left this list in round 1* — closed as **both layers** ([D5](DECISIONS.md#d5)), by the owner himself |
| ER-14 | **No W4 *ship* PR merges until every W3 ([FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351)) child that carries an implementation is merged to main.** Children completed by decision, duplicated or cancelled do not hold the fence | D2. The risk is W4 shipping onto unlanded W3 *code*, so the condition is merge, not closure — this set already contains a child completed by decision, and closed-but-unmerged spec PRs are normal here. The fence is on merge, not on work |

**Where the fence stands · 2026-09-19.** The two W3 inputs this set depends on are **merged**: FIX-1377 ([#1911](https://github.com/fixpoint-labs/flow-state-dev/pull/1911)) and FIX-1416 ([#1909](https://github.com/fixpoint-labs/flow-state-dev/pull/1909)), on main at `d8e4c99`. Per a **relayed Linear read** (the Architect's, 2026-09-19 — Linear is unreachable from the session that wrote this, so it is *not* re-derived here), every other W3 child under FIX-1351 is Done or Duplicate except **FIX-1435 (Todo)** and **FIX-1449 (Backlog)**. Neither has a PR, a branch or a commit on main — that part is verified from GitHub — so if either carries an implementation it is unmerged, and **the fence stands**.

Lifting it turns on the one fact GitHub cannot supply: **whether either of those two carries an implementation at all.** If both are decision or duplicate work, the fence is already liftable. Re-derive that from Linear before treating it as lifted — ER-14 fails closed, and this sentence is the last known read, not a clearance.

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-15 | A cross-cutting question is commented **up** on the epic PR, never decided locally. FIX-1408's unclosed walls are **epic-owned**: FIX-1394's POC carries the evidence for exactly one — *which opt-in history packs are v1* — and the other four are parked in [Open](DECISIONS.md#open) | [DECISIONS.md](DECISIONS.md) is the single place. A local answer is a second authority. Narrowed on 2026-09-19: four of the five are session policy with no package content, and loading them on a package-format POC leaves its probe set unfixable |
| ER-16 | A child's Linear state is mirrored the moment it changes | The epic wake derives blocked-by from Linear. Caught once: FIX-1377 and FIX-1416 read *In Spec Review* while both spec PRs were closed and approved; corrected to In Development on 2026-09-18 |
| ER-17 | Every child routes to *spec* by default; only a `Bug` label re-routes | Fail-closed. All five carry `Design` + `Feature`, so all five spec |
| ER-18 | A child depending on FIX-1377 or FIX-1416 writes against the **landed code** at `d8e4c99` on main and names it. Where a W3 spec and that code disagree, **the code wins**, and the spec's looser promise is not a contract | Both landed on 2026-09-19 ([#1911](https://github.com/fixpoint-labs/flow-state-dev/pull/1911), [#1909](https://github.com/fixpoint-labs/flow-state-dev/pull/1909)); this rule pointed at their approved specs while they were unbuilt. **FIX-1416 shipped stricter than its spec.** The spec said a block in a seat's own `blocks/` folder is callable without being listed anywhere; the merged `resolveDeclaredTools` (`packages/workforce/src/hire.ts`) promotes only names the seat declared in `tools:`, so an unlisted colocated block is not callable. A child carrying the spec's sentence forward would build against behaviour that does not exist |
| ER-19 | The project's **PR-5** — a new surface uses the settled Layer 2 name, never the superseded one — is owned by **FIX-1385** | From the project spec ([#1818](https://github.com/fixpoint-labs/flow-state-dev/pull/1818)). FIX-1385 mints the largest new vocabulary surface in the set |
| ER-23 | **A shared contract's spec is approved before the next child specs against it.** FIX-1405's reader contract closes before FIX-817 starts; the `tools:` fence settles across FIX-1416 → FIX-1394 → FIX-1415 in that order FIX-1405 has specified it: **`readDeclaredRoster(root)`** on `@flow-state-dev/workforce/loader` — behind `./loader`, since the root is deliberately node-free — joining the three existing readers, walking nothing itself, **collecting rather than throwing**, and joining the two layers on **`id` alone** | Two issues designing one discovery API at the same time is how you ship two of them. Orders the spec work without re-parenting — and it **outlives FIX-817 leaving the set** ([D6](DECISIONS.md#d6)): the dependency is on the contract, not on the parent |

## The proof

| # | The epic's first cut is done when | Proved by |
|---|---|---|
| ER-20 | Work filed on a **channel or org board** wakes a seat that runs it, and a coordinator seat assigns work to **team** seats — on the real path, seats and channels declared in files | **FIX-1430**, adopted as the proof at the objective gate on 2026-09-19 ([D6](DECISIONS.md#d6)) |
| ER-21 | The queue a coordinator sees is a **view** over existing task state and seat idle — no new status, no new L1 type | FIX-1430's goal check · ER-11 |
| ER-22 | The docs teach routing as something a team gets by attaching a board to a channel, not something it builds — and teach `assignee` and *seat* as two different things | The epic's docs pass · ER-5 |

**ER-20 is the rule to read twice.** It is the only rule that makes the epic's claim falsifiable,
and FIX-1430 now owns it. Wrapping on ER-1, ER-2 and ER-3 shipping — without ER-20 run on the real
path — would be claiming routing works rather than having seen it.
