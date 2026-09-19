# FIX-1407 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

What every child spec and implementation must satisfy, and what a cross-spec review checks. Numbers
are stable ids, not an order. ER-1 to ER-5 and ER-19 are the rows of the ownership matrix in
[DECISIONS.md](DECISIONS.md#who-owns-what).

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | Work for a team lives as a row on a **channel or org board** — `0..N` TaskCollections on a channel — and a seat claims it or is assigned it. Channel actions and `taskTools` are **two doors on one mutation surface** | FIX-1385 | FIX-1385's spec · the proof |
| ER-2 | A seat carries **one package format**, two attachment modes: seat **always-on**, library **opt-in**. A tool, a skill and an instruction have one home between them. *After POC ratify* is the rule, not a hedge | FIX-1394, after POC ratify | FIX-1394's POC matrix · the proof, which may not invent a third shape |
| ER-3 | Inventory is **two layers**: a **declared roster** composed at read time from the existing readers, and the **live org resource** ChannelFlow updates. The live layer answers membership, author check, fan-out and DM find-or-create **at inventory level** — who exists and is open. It **does not own or mirror a channel's session-local `members`, nor its post-refusal fence**; that stays ChannelFlow-on-channel. The declared layer answers what the tree says exists, and never substitutes for the live one | FIX-1405 | FIX-1405's two prove-pressure callers · FIX-817's and FIX-1415's spec review, from outside the set |
| ER-4 | Dispatch always passes `parentSessionId`; the child binds its parent **for life at mint**. Parent history reaches a child only by **opt-in tools**; the default payload is the brief — `goal` / `constraints` / `acceptance` / `links`. **Linked is not nested** | FIX-1408 (D4) — **shipped as a decision**, so the first child over the wire is where it first gets tested | Every child's spec review |
| ER-5 | A board `assignee` is a **board-worker key**, not a Workforce seat; the two map by composition. `assignee` stays optional, and a registry board's "must be assigned" is discipline, not schema | FIX-1385 | FIX-1385's spec · FIX-1430's wiring |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-6 | No **Agent, Channel, Team, MessageBoard, TeamFlow, ChannelAdmin or SessionBoard as an L1 package type**; no revived `materializeAgent` or `AgentRegistry` | D3. Agent is an opinionated default *kind*; the rest are L2 opinion or nothing |
| ER-7 | No `team.*` (or other) wildcards before the inventory lands, and none blocking the channels convention | D5. Wildcards call the live layer later |
| ER-8 | No shipping the package collapse from FIX-1394's exploration alone, without a ratify | That ticket's posture: matrix → ratify → then ship tickets |
| ER-9 | No dumping a parent's full transcript, or its private seat history, into a child by default | D4. Channel transcript passes only when both are on that channel |
| ER-10 | Boards are not the mint door for sessions, DMs, posts or sub-agents. No assignable-channel routing, no Project-as-required | D1, D3. Conversation stays off the board |
| ER-11 | No expanding the L1 `TaskStatus` enum. Queue columns — idle, ready-for-review, waiting-on-you — are **L2 views** over status plus claim, assignee, park reason and seat idle | A second hold status was already refused |
| ER-12 | No second `WorkerRegistry`, mega-loader, mega-bus or parallel index of truth; no Graft rebuild for membership or DM lookup. **Compose is not a registry.** No relocating ChannelFlow's post fence onto the org resource, and no second authoritative copy of membership | D5. Two authoritative copies of membership is the incoherence, not the fix |
| <a name="er-13"></a>ER-13 | No closing an item on the Architect's **Still open** list without the owner: exact package schema · reuse-vs-create · nested cascade timing · how many POCs before a ship cut. Exploration may lean; leaning is not closing | Inventory helper-vs-resource left this list in round 1 — closed as **both layers** ([D5](DECISIONS.md#d5)), by the owner himself |
| ER-14 | **No W4 *ship* PR merges until every W3 ([FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351)) child that carries an implementation is merged to main.** Children completed by decision, duplicated or cancelled do not hold the fence | D2. The risk is W4 shipping onto unlanded W3 *code*, so the condition is merge, not closure |

**Where the fence stands · 2026-09-19.** Both W3 inputs are merged — FIX-1377
([#1911](https://github.com/fixpoint-labs/flow-state-dev/pull/1911)), FIX-1416
([#1909](https://github.com/fixpoint-labs/flow-state-dev/pull/1909)) — on main at `d8e4c99`. A
**relayed Linear read**, not re-derived here, leaves **FIX-1435** and **FIX-1449** as the only
non-terminal W3 children. GitHub confirms neither has a PR, branch or commit, but not whether
either *carries an implementation* — which is what the fence turns on. **It stands until that is
re-derived.**

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-15 | A cross-cutting question is commented **up** on the epic PR, never decided locally. FIX-1408's unclosed walls are **epic-owned**: FIX-1394's POC carries the evidence for exactly one — *which opt-in history packs are v1* — and the other four are parked in [Open](DECISIONS.md#open) | A local answer is a second authority. The four are session policy with no package content, and loading them on a package-format POC leaves its probe set unfixable |
| ER-16 | A child's Linear state is mirrored the moment it changes | The epic wake derives blocked-by from Linear, so stale state silently mis-orders the set |
| ER-17 | Every child routes to *spec* by default; only a `Bug` label re-routes | Fail-closed. All five carry `Design` + `Feature` |
| ER-18 | A child depending on FIX-1377 or FIX-1416 writes against the **landed code** at `d8e4c99` and names it. Where a W3 spec and that code disagree, **the code wins** | **FIX-1416 shipped stricter than its spec**, which said a seat's own `blocks/` folder is callable without being listed anywhere. `resolveDeclaredTools` (`packages/workforce/src/hire.ts`) promotes only names declared in `tools:`. A child carrying the spec's sentence forward builds against behaviour that does not exist |
| ER-19 | The project's **PR-5** — a new surface uses the settled Layer 2 name, never the superseded one — is owned by **FIX-1385** | From the project spec ([#1818](https://github.com/fixpoint-labs/flow-state-dev/pull/1818)). FIX-1385 mints the largest new vocabulary surface in the set |
| ER-23 | **A shared contract's spec is approved before the next child specs against it.** FIX-1405's reader contract — **`readDeclaredRoster(root)`** on `@flow-state-dev/workforce/loader`, collecting rather than throwing, joining the layers on **`id` alone** — closes before FIX-817 starts; the `tools:` fence settles across FIX-1416 → FIX-1394 → FIX-1415 in that order | Two issues designing one discovery API at once is how you ship two of them. It outlives FIX-817 leaving the set: the dependency is on the contract, not the parent |

## The proof

| # | The epic's first cut is done when | Proved by |
|---|---|---|
| ER-20 | Work filed on a **channel or org board** wakes a seat that runs it, and a coordinator seat assigns work to **team** seats — on the real path, seats and channels declared in files | **FIX-1430**, adopted as the proof at the objective gate, 2026-09-19 ([D6](DECISIONS.md#d6)) |
| ER-21 | The queue a coordinator sees is a **view** over existing task state and seat idle — no new status, no new L1 type | FIX-1430's goal check · ER-11 |
| ER-22 | The docs teach routing as something a team gets by attaching a board to a channel, **not something it builds** — and teach `assignee` and *seat* as two different things | The epic's docs pass · ER-5 |

**ER-20 is the rule to read twice.** It is the only rule that makes the epic's claim falsifiable.
Wrapping on ER-1, ER-2 and ER-3 shipping, without ER-20 run on the real path, would be claiming
routing works rather than having seen it.
