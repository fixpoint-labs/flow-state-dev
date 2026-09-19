# FIX-1407 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

<!-- EDITING NOTE. ER-22's "not something it builds" is the rule, not emphasis: the
     contrast is the whole point. An editorial pass on 2026-09-19 cut it and restored it
     on review; the 2026-09-19 refresh pass held it deliberately. Cut derivation here
     freely; do not cut that clause. -->

What every child spec and implementation must satisfy, and what a cross-spec review checks. Numbers
are stable ids, not an order. ER-1 to ER-5 and ER-19 are the rows of the ownership matrix in
[DECISIONS.md](DECISIONS.md#who-owns-what).

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | Work for a team lives as a row on a **channel or org board** — `0..N` TaskCollections on a channel — and a seat claims it or is assigned it. Channel actions and `taskTools` are **two doors on one mutation surface** | FIX-1385 | FIX-1385's spec · the proof |
| ER-2 | **A seat's package format is whatever FIX-1394's ratify records**, and no child may pre-name what is still open. **Recorded 2026-09-19 — the collapse is the answer:** one format, **authored in Markdown**, scoped to **instructions and tools**, two attachment modes — seat **always-on**, library **opt-in**. *Don't collapse* is no longer a live result. **The format may not be disk-only:** the owner's direction is that packages will eventually be LLM-authored and stored as a **resource**, never saved to disk — binding on the design, though v1 ships the file. **Documents settled 2026-09-19 — all org-scoped for now:** a seat's document is a resource under that seat on the org, and v1 carries no per-seat document slot. Per-resource configurability is deferred to **resource templates** ("used to define the resource, but isn't the resource itself"), which do not exist yet — so a child that builds one now is building against nothing. **Nothing in ER-2 is open any more**, and the ratify is unblocked | FIX-1394, at the ratify | FIX-1394's POC matrix · the proof, which may not invent a shape outside the recorded one · every ship ticket's review, on the not-disk-only and org-scoped halves |
| ER-3 | Inventory is **two layers**: a **declared roster** composed at read time from the existing readers, and the **live org resource** ChannelFlow updates. The live layer answers membership, author check, fan-out and DM find-or-create **at inventory level** — who exists and is open. It **does not own or mirror a channel's session-local `members`, nor its post-refusal fence**; that stays ChannelFlow-on-channel. The declared layer answers what the tree says exists, and never substitutes for the live one | FIX-1405 | FIX-1405's two prove-pressure callers — the **devforce and pentest labs**, both off their private copies · FIX-817's and FIX-1415's spec review, from outside the set. **Not FIX-1385**, which reads through the roster only if it has landed |
| ER-4 | Dispatch always passes `parentSessionId`; the child binds its parent **for life at mint**. Parent history reaches a child only by **opt-in tools**; the default payload is the brief — `goal` / `constraints` / `acceptance` / `links`. **Linked is not nested** | FIX-1408 (D4) — **shipped as a decision**, so the first child over the wire is where it first gets tested | Every child's spec review. **First read on the wire, 2026-09-19:** the parent a child binds is the **draining seat's** session, not the filer's ([the corrected mechanisms](DECISIONS.md#refuted-mechanisms)) |
| ER-5 | A board `assignee` is a **board-worker key**, not a Workforce seat; the two map by composition. `assignee` stays optional, and a registry board's "must be assigned" is discipline, not schema | FIX-1385 | FIX-1385's spec · FIX-1430's wiring |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-6 | No **Agent, Channel, Team, MessageBoard, TeamFlow, ChannelAdmin or SessionBoard as an L1 package type**; no revived `materializeAgent` or `AgentRegistry` | D3. Agent is an opinionated default *kind*; the rest are L2 opinion or nothing |
| ER-7 | No `team.*` (or other) wildcards before the inventory lands, and none blocking the channels convention | D5. Wildcards call the live layer later |
| ER-8 | No shipping the package collapse from FIX-1394's exploration alone, without a ratify. **Discharged 2026-09-19:** the ratify is recorded ([both forks](DECISIONS.md#authorship-answer)) and the ship ticket is cut — **FIX-1459**, which is [related, not a child](SPEC.md#related-not-children). Nothing is held behind this row any more; ER-14 still fences FIX-1459 when it is picked up, on its own terms | That ticket's posture: matrix → ratify → then ship tickets |
| ER-9 | No dumping a parent's full transcript, or its private seat history, into a child by default | D4. Channel transcript passes only when both are on that channel |
| ER-10 | Boards are not the mint door for sessions, DMs, posts or sub-agents. No assignable-channel routing, no Project-as-required | D1, D3. Conversation stays off the board |
| ER-11 | No expanding the L1 `TaskStatus` enum. Queue columns — idle, ready-for-review, waiting-on-you — are **L2 views** over status plus claim, assignee, park reason and seat idle | A second hold status was already refused |
| ER-12 | No second `WorkerRegistry`, mega-loader, mega-bus or parallel index of truth; no Graft rebuild for membership or DM lookup. **Compose is not a registry.** No relocating ChannelFlow's post fence onto the org resource, and no second authoritative copy of membership | D5. Two authoritative copies of membership is the incoherence, not the fix |
| <a name="er-13"></a>ER-13 | No closing an item on the Architect's **Still open** list without the owner: exact package schema · reuse-vs-create · nested cascade timing · how many POCs before a ship cut. Exploration may lean; leaning is not closing | Inventory helper-vs-resource left this list in round 1 — closed as **both layers** ([D5](DECISIONS.md#d5)), by the owner himself |
| ER-14 | **No W4 *ship* PR merges until every W3 ([FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351)) child that carries an implementation is merged to main.** Children completed by decision, duplicated or cancelled do not hold the fence | D2. The risk is W4 shipping onto unlanded W3 *code*, so the condition is merge, not closure |

**Where the fence stands · 2026-09-19.** Both W3 inputs are merged — FIX-1377
([#1911](https://github.com/fixpoint-labs/flow-state-dev/pull/1911)), FIX-1416
([#1909](https://github.com/fixpoint-labs/flow-state-dev/pull/1909)) — on main at `d8e4c99`. Of
FIX-1351's 22 children, exactly two are non-terminal: **FIX-1435** (`Todo`) and **FIX-1449**
(`Backlog`), neither with a PR, branch or commit. On the question the fence turns on, **FIX-1435
carries an implementation** — it collapses two copies of the slot-descent walk in the resources
loaders, framework code W4 children read. FIX-1449 is Atlas HTML staleness and carries none.

**So the fence has not lifted, and four W4 ship PRs have merged under it** — FIX-1385's
[#1922](https://github.com/fixpoint-labs/flow-state-dev/pull/1922), FIX-1405's
[#1920](https://github.com/fixpoint-labs/flow-state-dev/pull/1920),
[#1923](https://github.com/fixpoint-labs/flow-state-dev/pull/1923) and
[#1928](https://github.com/fixpoint-labs/flow-state-dev/pull/1928), all shipping
`packages/workforce` with changesets. **The owner merged the last of them himself**, on 2026-09-19.
That settles #1928; it is not a change to this rule, and he has said nothing about one.

**What is still fenced.** **FIX-1459**, the ratified format's ship ticket — outside the set, but it
edits `packages/workforce`, so the fence reaches it when it is picked up; **FIX-1381's eventual implementation**, which edits `packages/workforce` and so will be a
ship PR when it exists; and **the
[wrap term](PLAN.md#wrap)**, which cannot complete while a W4 ship PR is parked.

**[FIX-1451](SPEC.md#the-seventh-child)'s fix resolved out of the conditional, and it is the first
real test of [the operating default](DECISIONS.md#fence-default).** The changeset call was made:
[#1936](https://github.com/fixpoint-labs/flow-state-dev/pull/1936) carries one
(`@flow-state-dev/orchestration`, patch), and **it stays** — the fix changes prompt text a
consumer's generator receives and adds a public export, so dropping it to escape the fence would be
gaming the rule. **On ER-14 as written it is fenced. On the default — per-PR file overlap — it is
clear:** FIX-1435's scope is the workforce **resources loader** (`walkResourceSlots`) plus a
TypeScript-extension dedupe in Door B's two codegen files, and its Out excludes widening the walk;
#1936 touches `packages/orchestration/src/skills/*`, a `packages/core` doc comment, `apps/docs`,
two tests and the changeset, with `packages/workforce` appearing **only** as a test file. **No
overlap, not one file.** This is the first time the default has decided a PR the owner did not merge
himself — the rule and the default disagree here, which is what makes it a test of the default
rather than a restatement. **It narrows nothing:** [the re-gate](DECISIONS.md#er-14-re-gate) is
still pending and unanswered, and if the owner countermands the default this fix goes back behind
the fence with everything else. **No merge is authorised by it** — the epic has no objection to
#1936 merging when it is otherwise ready; the merge is the owner's.

**How the epic behaves meanwhile.** ER-14 derives from [D2](DECISIONS.md#d2), which the owner
ratified, so the epic cannot narrow the rule — and it has not. What it has adopted is an
[operating default](DECISIONS.md#fence-default): treat the fence as narrowed to per-PR file
overlap, read from the owner's action rather than his words, and **countermandable by him at any
time**. Whether the rule itself narrows is still **[a pending re-gate](DECISIONS.md#er-14-re-gate)**
with the owner, where the recommendation is the epic's and unanswered.

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-15 | A cross-cutting question is commented **up** on the epic PR, never decided locally. FIX-1408's unclosed walls are **epic-owned**, and their current standing is in [Open](DECISIONS.md#open) | A local answer is a second authority. A wall closes on evidence a child produced and folded up here — never on a child's own say-so |
| ER-16 | A child's Linear state is mirrored the moment it changes. **Holding as of 2026-09-19**, the egress outage over and the queued backlog written | The epic wake derives blocked-by from Linear, so stale state silently mis-orders the set. The wrap term is **not** re-coupled to Linear by this — it stays [derived from GitHub](PLAN.md#terminal), because what makes code shipped is a merge. What Linear *does* decide is which children exist, and it decided it twice on 2026-09-19: the set is **seven** — FIX-1381 pulled in by the owner ([D6](DECISIONS.md#d6-extended)), and [FIX-1451](SPEC.md#the-seventh-child) confirmed as having been parented all along ([the correction](DECISIONS.md#d6-seventh)). **No unconfirmed remainder.** The second of those is the rule earning its place: the tracker was right and this spec was wrong |
| ER-17 | Every child routes to *spec* by default; only a `Bug` label re-routes | Fail-closed. The original five carry `Design` + `Feature`, and **FIX-1381 is routing to spec** like any other child — its spec is in review on #1935. **[FIX-1451](SPEC.md#the-seventh-child) is the first child to take the other branch:** labelled `Bug`, so it skips the spec and enters at implementation with its PR as the review surface. There is no spec gate to wait for on it, and its absence is not a gap |
| ER-18 | A child depending on FIX-1377 or FIX-1416 writes against the **landed code** at `d8e4c99` and names it. Where a W3 spec and that code disagree, **the code wins** | **FIX-1416 shipped stricter than its spec**, which said a seat's own `blocks/` folder is callable without being listed anywhere. `resolveDeclaredTools` (`packages/workforce/src/hire.ts`) promotes only names declared in `tools:`, so a child carrying the spec's sentence forward builds against behaviour that does not exist |
| ER-19 | The project's **PR-5** — a new surface uses the settled Layer 2 name, never the superseded one — is met here as **a check over this set's own diff**, owned by **FIX-1385**. It is **not** a repo-wide rename | The repo-wide pass waits on the project's vocabulary lock (**PD-4** — running it early pays the rename twice), so it stays the project's and has **no owner inside W4**: named out here rather than dropped, so nobody wraps this epic believing it ran |
| ER-23 | **A shared contract's spec is approved before the next child specs against it.** FIX-1405's reader contract — **`readDeclaredRoster(root)`** on `@flow-state-dev/workforce/loader`, collecting rather than throwing, joining the layers on **`id` alone** — closes before FIX-817 starts; the `tools:` fence settles across FIX-1416 → FIX-1394 → FIX-1415 in that order | Two issues designing one discovery API at once is how you ship two of them. It outlives FIX-817 leaving the set: the dependency is on the contract, not the parent |

## The proof

| # | The epic's first cut is done when | Proved by |
|---|---|---|
| ER-20 | Work filed on a **channel or org board** wakes a seat that runs it, and a coordinator seat assigns work to **team** seats — on the real path, seats and channels declared in files | **FIX-1430 owns it**, adopted as the proof at the objective gate ([D6](DECISIONS.md#d6)). **FIX-1385 provides the surface it stands on and does not own it** — one row filed and claimed on a board is not ER-20; ER-20 is a coordinator assigning a queue across several seats |
| ER-21 | The queue a coordinator sees is a **view** over existing task state and seat idle — no new status, no new L1 type | FIX-1430's goal check · ER-11 |
| ER-22 | The docs teach routing as something a team gets by attaching a board to a channel, **not something it builds** — and teach `assignee` and *seat* as two different things | The epic's docs pass · ER-5 |

**ER-20 is the rule to read twice.** It is the only rule that makes the epic's claim falsifiable.
Wrapping on ER-1, ER-2 and ER-3 shipping, without ER-20 run on the real path, would be claiming
routing works rather than having seen it. **As of 2026-09-19 it has not run** — FIX-1430's verdict
log carries the row as [`NOT RUN`](SPEC.md#er-20-has-not-run) for want of a model credential, and
the [wrap](PLAN.md#wrap) is enforced against this rule as written.
