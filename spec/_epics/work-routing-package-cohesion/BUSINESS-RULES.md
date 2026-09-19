# FIX-1407 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

<!-- EDITING NOTE. ER-22's "not something it builds" is the rule, not emphasis: the
     contrast is the whole point. An editorial pass on 2026-09-19 cut it and restored it
     on review. Cut derivation here freely; do not cut that clause. -->

What every child spec and implementation must satisfy, and what a cross-spec review checks. Numbers
are stable ids, not an order. ER-1 to ER-5 and ER-19 are the rows of the ownership matrix in
[DECISIONS.md](DECISIONS.md#who-owns-what).

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | Work for a team lives as a row on a **channel or org board** — `0..N` TaskCollections on a channel — and a seat claims it or is assigned it. Channel actions and `taskTools` are **two doors on one mutation surface** | FIX-1385 | FIX-1385's spec · the proof |
| ER-2 | **A seat's package format is whatever [FIX-1394](https://github.com/fixpoint-labs/flow-state-dev/pull/1915)'s ratify records**, and no child may pre-name what is still open. **Recorded 2026-09-19 — the collapse is the answer:** one format, **authored in Markdown**, scoped to **instructions and tools**, with two attachment modes — seat **always-on**, library **opt-in** — so a tool, a skill and an instruction have one home between them. *Don't collapse* is no longer a live result. **The format may not be disk-only:** packages an LLM writes for someone are stored as a **resource**, not saved to disk, so a reader that can only walk the filesystem fails the format's own first case. Still open, and still nobody's to pre-name: **whether documents are in v1**. No child invents a shape outside this | FIX-1394, at the ratify | FIX-1394's POC matrix · the proof, which may not invent a shape outside the recorded one · every ship ticket's review, on the not-disk-only half |
| ER-3 | Inventory is **two layers**: a **declared roster** composed at read time from the existing readers, and the **live org resource** ChannelFlow updates. The live layer answers membership, author check, fan-out and DM find-or-create **at inventory level** — who exists and is open. It **does not own or mirror a channel's session-local `members`, nor its post-refusal fence**; that stays ChannelFlow-on-channel. The declared layer answers what the tree says exists, and never substitutes for the live one | FIX-1405 | FIX-1405's two prove-pressure callers — the **devforce and pentest labs**, both off their private copies in its PR-A · FIX-817's and FIX-1415's spec review, from outside the set. **Not FIX-1385**, which reads through the roster only if it has landed |
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

**Where the fence stands · 2026-09-19, re-derived from Linear directly.** Both W3 inputs are merged
— FIX-1377 ([#1911](https://github.com/fixpoint-labs/flow-state-dev/pull/1911)), FIX-1416
([#1909](https://github.com/fixpoint-labs/flow-state-dev/pull/1909)) — on main at `d8e4c99`. Of
FIX-1351's 22 children, exactly two are still non-terminal, which confirms the earlier relayed read:
**FIX-1435** (`Todo`) and **FIX-1449** (`Backlog`). Neither has a PR, branch or commit. On the
question the fence actually turns on: **FIX-1435 carries an implementation** — it collapses two
copies of the slot-descent walk in the resources loaders, which is framework code W4 children read.
FIX-1449 is Atlas HTML staleness and carries none.

**So the fence had not lifted, and three W4 ship PRs merged under it** — FIX-1385's
[#1922](https://github.com/fixpoint-labs/flow-state-dev/pull/1922) and FIX-1405's
[#1920](https://github.com/fixpoint-labs/flow-state-dev/pull/1920) and
[#1923](https://github.com/fixpoint-labs/flow-state-dev/pull/1923), all on 2026-09-19, all shipping
`packages/workforce` with changesets. Recorded, not re-decided: ER-14 derives from
[D2](DECISIONS.md#d2), which the owner ratified at the objective gate, so the epic cannot narrow it
here. **Either the fence's condition is wider than it needs to be** — its stated risk is W4 shipping
onto unlanded W3 *code*, and nothing in those three diffs touches the walk FIX-1435 dedupes — **or
three merges went early.** For the owner, with [the other open questions](DECISIONS.md#open).

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-15 | A cross-cutting question is commented **up** on the epic PR, never decided locally. FIX-1408's unclosed walls are **epic-owned**: FIX-1394's POC carries the evidence for exactly one — *which opt-in history packs are v1* — and the other four are parked in [Open](DECISIONS.md#open) | A local answer is a second authority. The four are session policy with no package content, and loading them on a package-format POC leaves its probe set unfixable |
| ER-16 | A child's Linear state is mirrored the moment it changes. **Holding again as of 2026-09-19:** the egress is restored and the whole queued backlog is written — every child's status, the four approved specs as documents on their issues, and three new tickets (FIX-1451, FIX-1452, FIX-1453). The branch stays the source and Linear the mirror; neither is now a surface to read past | The epic wake derives blocked-by from Linear, so stale state silently mis-orders the set. That exposure is closed. The wrap term is **not** re-coupled to Linear by this: it stays [derived from GitHub](PLAN.md#terminal), because what makes code shipped is a merge, not a tracker row — the outage only made that visible. What Linear *does* now decide is which children exist, and it currently lists [six](SPEC.md#the-sixth-child) against a ratified five |
| ER-17 | Every child routes to *spec* by default; only a `Bug` label re-routes | Fail-closed. All five carry `Design` + `Feature` |
| ER-18 | A child depending on FIX-1377 or FIX-1416 writes against the **landed code** at `d8e4c99` and names it. Where a W3 spec and that code disagree, **the code wins** | **FIX-1416 shipped stricter than its spec**, which said a seat's own `blocks/` folder is callable without being listed anywhere. `resolveDeclaredTools` (`packages/workforce/src/hire.ts`) promotes only names declared in `tools:`. A child carrying the spec's sentence forward builds against behaviour that does not exist |
| ER-19 | The project's **PR-5** — a new surface uses the settled Layer 2 name, never the superseded one — is met here as **a check over this set's own diff**, owned by **FIX-1385** ([its BR-14](https://github.com/fixpoint-labs/flow-state-dev/pull/1917)). It is **not** a repo-wide rename | From the project spec ([#1818](https://github.com/fixpoint-labs/flow-state-dev/pull/1818)). FIX-1385 mints the largest new vocabulary surface in the set. The repo-wide pass waits on the vocabulary lock (project **PD-4** — running it early pays the rename twice), so it stays the **project's** and has **no owner inside W4**: named out here rather than dropped, so nobody wraps this epic believing it ran |
| ER-23 | **A shared contract's spec is approved before the next child specs against it.** FIX-1405's reader contract — **`readDeclaredRoster(root)`** on `@flow-state-dev/workforce/loader`, collecting rather than throwing, joining the layers on **`id` alone** — closes before FIX-817 starts; the `tools:` fence settles across FIX-1416 → FIX-1394 → FIX-1415 in that order | Two issues designing one discovery API at once is how you ship two of them. It outlives FIX-817 leaving the set: the dependency is on the contract, not the parent |

## The proof

| # | The epic's first cut is done when | Proved by |
|---|---|---|
| ER-20 | Work filed on a **channel or org board** wakes a seat that runs it, and a coordinator seat assigns work to **team** seats — on the real path, seats and channels declared in files | **FIX-1430 owns it**, adopted as the proof at the objective gate, 2026-09-19 ([D6](DECISIONS.md#d6)). **FIX-1385 provides the surface it stands on and does not own it** — one row filed and claimed on a board is not ER-20; ER-20 is a coordinator assigning a queue across several seats |
| ER-21 | The queue a coordinator sees is a **view** over existing task state and seat idle — no new status, no new L1 type | FIX-1430's goal check · ER-11 |
| ER-22 | The docs teach routing as something a team gets by attaching a board to a channel, **not something it builds** — and teach `assignee` and *seat* as two different things | The epic's docs pass · ER-5 |

**ER-20 is the rule to read twice.** It is the only rule that makes the epic's claim falsifiable.
Wrapping on ER-1, ER-2 and ER-3 shipping, without ER-20 run on the real path, would be claiming
routing works rather than having seen it.
