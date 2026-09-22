# FIX-1477 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Written for the implementing agent. IDs cross-reference [BUSINESS-RULES.md](BUSINESS-RULES.md)
(BR-n) and [DECISIONS.md](DECISIONS.md) (D-n). `tdd`. **Five PRs**, seamed at the package
boundary: PR-A is the public surface and is checkable with no app at all; PR-B and PR-C are the
two consumers and are independent of each other. Two more split off as the work met reality —
S9 ahead of PR-C as the plan allowed, and the two panels into their own PR once their
collections turned out to need a read declaration ([PR plan](#pr-plan)).

## Surfaces

| ID | Package · role | Change | Rules |
|---|---|---|---|
| S1 | `client` · the session-list query | One exported helper turning a flow entry into `ListSessionsOptions`: an instance id for `cardinality: "collection"`, a kind for `"singleton"`, and a kind for an address the flow list does not yet carry. **The only place that branch is written** — it replaces **three** copies, not one ([At implement time](#at-implement-time)) | BR-1 BR-2 BR-12 |
| S2 | `react` · the flow inventory | One read of the flow list per host, grouped by `kind`. The grouping level is the new work: today's list is flat over instances | BR-5 BR-6 BR-10 |
| S3 | `react` · leaf sessions | The session list for **one leaf**, gated on that leaf being open. The developer tool's read fence **moves** into `react` and is exported — not copied, and not reduced to an `openLeafId !== leafId` guard, which catches half of what it does ([Guardrails](#guardrails)). `checkInterrupted` does not come with it | BR-7 – BR-12 |
| S4 | `react` · `FlowNavigator` | Sections (label + kind filter), kind rows, derived depth, expand state, one selection, row content through slots. Theming and dependencies are BR-16 and BR-17's | BR-1 – BR-11 BR-16 BR-17 BR-24 BR-27 |
| S5 | `react` · `Roster` | Reads the durable roster collection [FIX-1475](https://linear.app/fixpoint-labs/issue/FIX-1475) ships, including its skipped-seat problems list. Organization scoping is the collection's, not the component's. **It needs a governing session whose flow declares that collection — the shell declares none — and the collection has to permit a browser read, which it does not yet** ([Blocked on](#blocked-on), [D4](DECISIONS.md#d4)) | BR-19 BR-20 |
| S6 | `react` · `BoardColumns` | Reads one board's ledger, grouped by the **existing** task statuses. The empty column states the likely cause rather than spinning. **Same read permission as `S5`, and for the board it is not a line at the call site** ([Blocked on](#blocked-on)) | BR-21 BR-22 |
| S7 | `devtool` · consume, and **remove** | Take a dependency on `@flow-state-dev/react`. Render S4 with the tool's own skin and its affordances as slots. **Delete** `src/react/components/navigator/`, `src/react/hooks/use-sessions.ts` and `src/react/hooks/use-read-fence.ts`, repointing its three remaining fence users (`DevToolPanel.tsx`, `use-child-sessions.ts`, `use-workspace-fence.ts`) and their test at the `react` export — an import path, no behaviour change. **The tool's bearer transport has to survive the move** | BR-15 BR-17 BR-29 |
| S8 | kitchen-sink · the shell | `app/page.tsx`: the rail becomes one `FlowNavigator` with a Channels and a Seats section; the right panel becomes standing `BoardColumns` + `Roster` and **loses its build-mode conditional**; the narrow-width order is wired. **Remove** `components/session-sidebar.tsx` | BR-13 BR-18 BR-25 – BR-28 |
| S9 | kitchen-sink · the drifted copies | Reconcile the **five** registry-installed files that no longer match their source: `conversation.tsx`, `message.tsx`, `chat-assistant.tsx`, `task-plan.tsx`, `task-plan-state.ts`. Each is either pushed back into the registry or reverted to it — never left forked | BR-14 |
| S10 | Docs · changeset | [DOCS.md](DOCS.md)'s operations; `packages/react/README.md`; `apps/kitchen-sink/README.md`. Changesets are **per-PR, not one batch** — see [Changesets](#changesets). **None for kitchen-sink** — private (BP-022) |  |

**S2, S3 and S4 are one internal module, not three exports.** Only `FlowNavigator` and the read
fence leave the package ([Pinned names](#pinned-names)). Three public hooks would let three
consumers each trigger their own flow-list read, which is BR-10 lost by export rather than by bug.

**What is not mine to remove.** The **six-control strip and the four modes** are
[FIX-1478](https://linear.app/fixpoint-labs/issue/FIX-1478)'s; this issue owns only what takes the
freed row, and the answer is nothing. The **background-work panel stays where it is**, commented
up rather than settled here ([Follow-ups](#follow-ups)).

## PR plan

**Status is part of the plan.** A row that reads as pending when it merged is the same staleness as a stale line number.

| PR | Surfaces | depends_on | State | Why this seam |
|---|---|---|---|---|
| PR-A · [#2006](https://github.com/fixpoint-labs/flow-state-dev/pull/2006) | S1 S2 S3 S4 · `packages/react/README.md` · its changeset ([Changesets](#changesets)) | — | **merged** | The public boundary first (BP-004). Checkable with no app running, and every consumer needs it before it can start. **S5 and S6 were carved out of it** — they were planned here and could not ship here, because their collections refuse a browser read ([Blocked on](#blocked-on)) |
| PR-B · [#2011](https://github.com/fixpoint-labs/flow-state-dev/pull/2011) | S7 | PR-A | **merged** | The reusability proof ([ER-24](../../epics/FIX-1455/BUSINESS-RULES.md)). Deliberately **not** behind PR-C: it needs nothing from FIX-1475 or FIX-1476, so the epic's gate stops depending on two siblings landing |
| S9's own · [#2019](https://github.com/fixpoint-labs/flow-state-dev/pull/2019) | S9 | — | **merged** | Split off ahead of PR-C exactly as this plan allowed: drift reconciliation is checkable with nothing else built, so a failure in it is attributable to drift rather than to shell wiring |
| PR-A2 · [#2036](https://github.com/fixpoint-labs/flow-state-dev/pull/2036) | S5 S6 | PR-A | **open** | The two panels, plus the one-line read declaration each of their collections needs. Its own PR because that declaration is substrate work PR-A was not carrying, and because it waits on FIX-1475 and FIX-1476 while PR-A did not |
| PR-C | S8 S9† · kitchen-sink README · [DOCS.md](DOCS.md) | PR-A, PR-A2 | **not opened** | The shell. Needs real collections to render, so it is the one that waits on siblings. †S9 already shipped as #2019 |

**S9 landed first, on its own — the reasoning, kept because it is why.** V8 was red on `main`, so
drift reconciliation was checkable with nothing else built, and a failure in it was attributable
to drift rather than to shell wiring. It shipped as #2019 ahead of PR-C, which was the plan
rather than the fallback. **VG cannot move the same way** — it asserts the shell's behaviour, and
a shell merged without its goal check is the defect class this epic keeps finding. **The docs
can**: [DOCS.md](DOCS.md) publishes with PR-C or a follow-up in the same window, reconciled
against the built components either way.

**The outside waits belong to PR-A2, not PR-C.** `Roster` needs FIX-1475's roster collection and
`BoardColumns` needs FIX-1476's channel kinds and boards — and since both panels moved out of
PR-A into #2036, that is the PR holding those waits. PR-A was checkable against fixtures without
either, which is why it could merge first; PR-B needed neither, which is the point of that split.
PR-C now waits on #2036 rather than on the siblings directly.

<a name="changesets"></a>
### Changesets

**Every one of them is `patch`, and each rides its own PR** — the list is not PR-A's job.

| Fragment | Packages | Bump | Rides |
|---|---|---|---|
| `flow-navigator-public-boundary` | `react`, `client` | `patch` | PR-A |
| `navigator-second-host` | `react` | `patch` | PR-B |
| `devtool-shipped-navigator` | `devtool` | `patch` | PR-B |
| `roster-and-board-panels` | `react` | `patch` | [#2036](https://github.com/fixpoint-labs/flow-state-dev/pull/2036), **open** |
| `panel-collections-client-read` | `workforce` | `patch` | [#2036](https://github.com/fixpoint-labs/flow-state-dev/pull/2036), **open** |
| — | `orchestration` | **none** | — |

The first three are on `main`. The last two are not — read them on #2036's branch, not here.

**Why `patch` and not `minor`, including for `workforce`.** The pre-1.0 rule is *"can this break
somebody"*, not *"is this a new capability"*
([release-notes-workflow.md](../../../docs/contributing/release-notes-workflow.md#pre-10-discipline-current-state),
which `AGENTS.md` defers to). Every change here is additive: a new export, a new optional
section field, and on the collections a `client` declaration plus an `expose` allowlist. No
consumer's existing code stops compiling or returns anything different. That the roster and the
board become browser-readable is a real posture change and it belongs in the **body** of
`panel-collections-client-read`, which already names the org scoping and what each row withholds
— not in the bump.

**No `orchestration` changeset — the shape is settled, though not yet merged.** The board's read
is built as an assign at `channel-board.ts:218` **on
[#2036](https://github.com/fixpoint-labs/flow-state-dev/pull/2036)'s branch**, carrying both
`state.read` and the `expose` allowlist, so `defineTaskCollection` never gains a forwarded option
and `orchestration` stays untouched. Read it there: on `main` that line is `resolveChannelBoard`
and `CHANNEL_BOARD_CLIENT_FIELDS` does not exist yet, which is consistent with
[Blocked on](#blocked-on) — neither collection declares a client read on `main`.

## Checks

Every row names what would make it fail. A check with no producible red state proves nothing.

| ID | Runs after | Passes when | Would fail if — the red state |
|---|---|---|---|
| V1 | S1 | A collection entry yields an instance-id filter **and no kind filter**; a singleton yields a kind filter **and no instance filter** | Return both keys, or the same key for both. Asserting the *absence* of the other key is the anti-game clause — a helper that sends both would pass a presence-only test and then silently over-filter. Third case: an address the flow list has **not loaded yet** must yield a kind filter — `useFlow` depends on that default today (`useFlow.ts:63`), so a helper that throws or guesses an id there regresses it |
| V2 | S2 | Two instances of one collection kind produce **one** kind row with two children | Run the same assertion against today's flat list (`packages/devtool/.../flow-list.tsx`, whose own header says "two copies of one kind are two rows here"). It fails. That is the red state, and it is available before a line is written |
| V3 | S3 S4 | Expanding a kind holding 40 instances makes **zero** session-list calls; expanding one instance makes exactly one | Move the fetch to the kind row: the counter reads 40. This is the epic's named foot-gun and the level that can fan out did not exist before this issue |
| V4 | S3 | Open leaf A, open leaf B, resolve A's response last → B's rows render and A's are discarded. **And** two reads of the *same* leaf resolving out of order → the older never overwrites the newer | Drop the fence: A's rows land under B. The second half is the one an identity-only guard passes — `openLeafId !== leafId` agrees with itself when both reads name one leaf, so only a sequence number fails it. Resolve the promises out of order in the test, or neither half can fail |
| V5 | S4 | The component's published props are exactly the allowed set — no depth, no levels, no per-kind override, no `orgId` (BR-3, BR-24) | Add any one of them. Written as an **allow-list over the whole prop set**, not a denylist of three names, so a fourth spelling fails too |
| V6 | S4 S8 | Rendered at 256px with every kind and every instance expanded, three indent levels are distinguishable and the rail has exactly **one** scroll container | Mount twice instead of once: two scroll containers. Assert on the expand-all state — a collapsed rail proves nothing here, which is the whole point of D7's mind-changer |
| V7 | S7 | The developer tool renders the shipped navigator, with its own affordances, `src/react/components/navigator/` does not exist, and a leaf read made through the tool's bearer `fetcher` carries the `Authorization` header (BR-29) | Keep one file: the existence assertion fails. **Assert the rendered DOM too**, not only the deletion — a deleted folder and a hand-rolled replacement elsewhere would pass a file check. For the transport half, build the component with `react`'s own default clients: the flow list still loads, because its route is exempt, and the leaf read 401s. That split is the failure that would otherwise ship |
| V8 | S9 | Every registry target **the app has installed** is byte-identical to its source, and the number compared is asserted. The manifest declares 25 items over **27 files**; the app installs 25 of them, and the two `generative/` targets it never took are not drift | **Red today: 5 of the 25 installed differ** — `conversation.tsx`, `message.tsx`, `chat-assistant.tsx`, `task-plan.tsx`, `task-plan-state.ts`. The count is the anti-game clause: deleting a manifest row, or quietly un-installing a target, would otherwise make the check pass by shipping less |
| V9 | S8 | No component the shell's three regions define reads flow, session, roster or board data except through a package export (BR-13) | **Red today**: the session sidebar imports session types from `@flow-state-dev/client` directly. Scoped to the regions [ER-7](../../epics/FIX-1455/BUSINESS-RULES.md) assigns this issue — rail, stream, panel — not to every file in the app |
| V10 | S4 S8 | Rendered at three widths: boards yield first, the rail second, the stream never (BR-25 – BR-28) | Reorder the breakpoints: the stream collapses below `sm` and the check catches it. Assert at all three widths, not two |
| V11 | S5 S6 | Each panel's collection is read over the **list** route with at least one row seeded, and the body carries **exactly** the projected fields that panel renders — no `claimedBy`, no lease, no retry ledger, no write log on a board row | Drop the `expose` (or the projection function) and the check goes red on the extra keys, not on a missing one. Asserting the *absence* of the withheld fields is the anti-game clause: a check that only looked for the fields it wanted would pass on the whole envelope. Seed a row first — a 200 with an empty list passes any field assertion vacuously, which is exactly how [`poc/read-gate/`](poc/read-gate/README.md) first fooled itself |
| V12 | S5 S6 | Reading either collection **without** its `client` declaration is refused `403 State read not permitted` | Remove the declaration: the panels go blank rather than silently reading. Pins the gate so a later refactor cannot delete the opt-in and leave the panels looking merely broken |
| VG | S8 | **Playwright, against the Next-built app** (`apps/kitchen-sink/e2e/`): the rail lists the kinds; a singleton channel kind opens straight into its conversations; a seat kind opens into seats and then into one seat's conversations; and the **network log shows no session-list request on the kind expand** | Pre-fetch everything: the DOM assertions still pass and the network assertion fails. The network half is what makes this a goal check rather than a screenshot |

**No model runs in any of this**, so no `goals/` check applies: every claim is about what a
browser does with data the server already has. VG is the real-path check, in a suite that already
drives the built app.

## Pinned names

| Where | Name | Why pinned |
|---|---|---|
| `react` export | `FlowNavigator` | Public, and the epic left it to this issue. It browses *flows*, and its second host browses flows that are not a workforce |
| `react` export | `Roster` | Public. The epic's documentation draft already promises it |
| `react` export | `BoardColumns` | Public. Same |
| Section prop | `sections`, each `{ label, kinds }` | Public, and it is the sanctioned shape of D8's "two filters are fine" — a label and a kind filter, never a depth |
| `react` export | `useReadFence` | Public by consequence: the developer tool imports it once its own copy is deleted, so the name is a decision rather than an accident |

Everything else — hook names, slot names, file layout, the CSS custom property names — is yours.

## Guardrails

| Rule | Because |
|---|---|
| Fetch sessions on **leaf** expand only | The kind level is new above what the developer tool has, so the level that can fan out did not previously exist. A per-row sweep before the list is the same shape wearing a different name |
| `react` gains no dependency that is not already one of ours | D1's whole content. A styling toolchain in `react` is installed by every app that takes the package, including the ones that render no workforce at all |
| Write the query branch once, in `client` | The developer tool can reach `client` today and `react` only after PR-B. Three copies of `{flowId}` versus `{flowKind}` is the defect this issue exists to remove, at the scale it has already reached (tenet 5) |
| The fence **moves**; it is not re-derived, and not reduced to comparing the open leaf id | It answers two hazards and a leaf id answers one: a response outliving its leaf, and two reads of *one* leaf racing, which only a sequence number can separate. Both are written down where it lives, `packages/devtool/src/react/hooks/use-read-fence.ts` |
| `checkInterrupted` does **not** come across with it | The tool sweeps stale active requests before every list (`use-sessions.ts:55–61`) — a second round trip on **every leaf expand**, and a rail pays only for the list it draws. Accepted cost: a request abandoned by a dead process keeps reading `in_progress` in the rail until something else sweeps it |
| Never attribute an ownerless session to an instance (BP-030) | Guessing an owner puts one copy's history under another. What that costs, and where such a row is reachable at all, is BR-12 |
| Never open a collection's browser read **bare** — declare what it publishes (BP-015) | With no projection the read returns the stored row unchanged, so a board would publish the whole task envelope including the execution coordinates its own board action withholds from a model. [Blocked on](#blocked-on) names the allowlist that already exists to copy |

## Docs

[DOCS.md](DOCS.md) carries the proposed prose and owns its own publish order.

## Sketch · pseudocode, illustrative, react to the shape

```
navigator(sections):
    entries ← the flow list, read once for this host
    for each section:
        kinds ← entries whose kind is in section.kinds, grouped by kind
        for each kind group:
            draw a kind row                              ← no fetch here, ever (V3)
            if the row is open:
                if this kind is a collection:
                    for each instance: draw an instance row
                        if THAT row is open: leafSessions(instance)   ← a leaf
                else:
                    leafSessions(the kind itself)                     ← also a leaf

leafSessions(leaf):
    options ← client.sessionQueryFor(leaf)      ← S1: instance id, or kind
    guard the response on the leaf still being the open one (V4)
```

**POC:** none for the navigator. Its two premises — that the cardinality branch is one field and
that the drill-down already works — are shipped and running in the developer tool, so the
evidence is the code rather than an experiment, and the genuinely new level (grouping rows under
their kind) is cheaper to build with V2 red in front of it than to sketch.

**POC for the panels:** [`poc/read-gate/`](poc/read-gate/README.md). It settles the two premises
that could not be read off the code — how a session with no resolved identity binds its
organization, and what actually refuses `S5` and `S6` a browser read.

## At implement time

Re-check these against the repo before building; each of them moves.

- **Has FIX-1475 landed, and does the roster collection permit a browser read yet?** `S5` reads
  `workforce/roster/*`. Its PR-A ships the collection, **not a read path for this app** — that
  declaration is this issue's, and [Blocked on](#blocked-on) says where it goes and what it costs.
  Read its `problems` dialect rather than inventing a third word for a skipped seat.

- **S1 replaces three copies of the branch, not one.** The developer tool's
  (`packages/devtool/src/react/hooks/use-sessions.ts:63`), the navigator leaves, **and
  `packages/react`'s own private `sessionFilter`** (`packages/react/src/hooks/useFlow.ts:63`) —
  which four `listSessions` constructions in that one file call, at `:117`, `:150`, `:167` and
  `:191`. Leaving the third is the defect this surface exists to remove, one package further in.
  Keep its not-yet-loaded default: an address the flow list does not carry reads as a singleton.

- **Does the shell read the flow list twice?** `useFlow` calls `listFlows` on mount
  (`useFlow.ts:164`) and the navigator reads it too. One extra call per host is acceptable; one
  per row is not. Decide whether the stream keeps `useFlow` for selection only or takes the
  navigator's inventory, and write down which.
- **Has FIX-1476 landed, and which kind names did it settle on?** `S6` needs its channel kinds
  and the board names on `CHANNEL.md`. A board's ledger id is `<channelId>.<boardName>`, minted
  by the workforce package — do not re-derive that join in the UI. Put its kind names into S8's
  Channels section; until then the section names `channel`. **It hands over convention and data
  and no rail UI at all** — if a `ChannelList` appears anywhere, the seam has been breached.
- **Do not plan or make edits in `apps/kitchen-sink/fsdev.config.ts` or `workforce/hire.ts`.**
  They are contested between FIX-1475 (in implementation) and FIX-1476. No surface in this plan
  needs them; if one appears to, that is a finding to raise rather than an edit to make.
- **Has FIX-1478's collapse trigger fired?** If the patterns shed folded into this issue, the
  control strip and the four modes become S8's, and `apps/kitchen-sink/e2e/mode-switching.spec.ts`
  goes with them. If it did not, leave both alone and read its keep-notes.
- **Has the Open fork — the seat list — been answered?** If the answer is *hold*, S8's Seats
  section is not mounted and the rail is Channels only; nothing else in the plan changes. If it is
  *ship*, S8 mounts both sections and [DOCS.md](DOCS.md) gains the limits paragraph the epic
  drafted. **It is the only fork left.** The roster and board question that used to sit beside it
  is answered ([D4](DECISIONS.md#d4)) and reaches neither the Seats section nor this bullet.
- **`@flow-state-dev/ui`** is a copy-in registry, not a published package, and it is `private`.
  If that changed, D1's *what would change my mind* has fired and the split wants re-reading.

## Blocked on

**Nothing external any more. `S5` and `S6` are parked on one declaration each, and the decision
that releases them has been made** ([D4](DECISIONS.md#d4)). What follows is what building it
costs, not what it waits for.

**One wall, and it is the same one for both panels.** Both collection-state read routes refuse a
browser unless the collection says it may be read — `config.client?.state?.read !== true` →
`403 State read not permitted` (`packages/engine/src/routes/resource-routes.ts:440` and `:560`).
Neither collection says so: `defineHiredRosterCollection()`
(`packages/workforce/src/roster/collections.ts:107`) and `channelBoardLedger()`
(`packages/workforce/src/channel/channel-board.ts:160`) pass no `client` config at all. So `S5`
and `S6` are blocked identically, **with or without a principal and with or without a
credential** — verified by execution rather than read: both return 403, and the same roster
shape carrying the declaration returns 200 ([`poc/read-gate/`](poc/read-gate/README.md)).

**Reading a board through the channel's board action is not a way around it.** That action
answers a model, not a screen: the action response a browser receives carries no handler output
at all (`ExecuteActionResponse`, `packages/client/src/types/index.ts:89`), and every region in
this app renders an **item** — no item type carries a handler's return value
([items.md](../../../docs/architecture/items.md)).

**The two declarations land inside this issue** ([DECISIONS.md → Decided, not
asked](DECISIONS.md#decided-not-asked)). Only one of them is a line at a call site, and the
difference is worth knowing before you start.

| | Where the declaration actually goes | What that costs |
|---|---|---|
| **Roster** (`S5`) | On the collection factory in `packages/workforce`, because the client config belongs to the declaration and there is exactly one of those | Every flow installing the roster becomes able to serve it to a browser, not just this shell — including FIX-1475's admin flow. The alternative, a second `defineResourceCollection` in the app with the same pattern, is a second copy of the contract the boot reload joins against, which is the drift this issue exists to close |
| **Board** (`S6`) | **Not** at FIX-1476's call site. `channelBoardLedger` builds its ledger through `defineTaskCollection`, which accepts no `client` option at all (`packages/orchestration/src/tasks/collection/define-task-collection.ts:54–83`) | Two shapes were open — a forwarded option on `defineTaskCollection`, or an assign at `channelBoardLedger`. **Settled: the assign**, built on [#2036](https://github.com/fixpoint-labs/flow-state-dev/pull/2036)'s branch at `channel-board.ts:218`, carrying `state.read` and the `expose` allowlist together. Not on `main` yet — the wall described above is still what `main` does. `orchestration` is untouched and takes no changeset ([Changesets](#changesets)) |

**The shell's flow must also declare each collection**, because the read resolves the ref
against the session's **owning flow** (`resolveOwnerFlow`, then `findResourceConfig`, in
`packages/engine/src/routes/resource-routes.ts`). Today the only flow declaring
`workforce/roster/*` is FIX-1475's `workforce-admin`. The roster is `flowIsolation: false`, so a
second flow in the same organization reads the same rows rather than a private set — that is
stated as the contract on the factory itself, and the boot reload already depends on it.
**The key it is declared under must contain no slash.** The read is addressed as
`/sessions/:id/resources/:ref/state`, so a ref spelt `workforce/roster` splits across path
segments and 404s; `roster` resolves. The collection's `workforce/roster/*` **pattern** is its
storage keys and is a different thing. Costs one confusing debugging cycle if you meet it cold.

**`S8` must bind the shell's session to the viewer's organization, or the panels are correct and
empty.** The rows are organization-scoped, so a session reads the organization it is bound to —
and a session binds to the organization of its resolved principal, or to the default one when
there is no principal (`packages/engine/src/routes/session-routes.ts:235`). Two deployments
therefore behave differently, and only one of them is fine by accident:

| Deployment | What happens |
|---|---|
| A clean clone with no admin tokens configured | `adminPrincipalResolver()` returns `undefined` (`apps/kitchen-sink/lib/workforce-admin-auth.ts:126`), so nothing authenticates anybody, hires and reads both land on the default organization, and the panels show the seats that were hired. The reference app demonstrates something real |
| A deployment that configures admin tokens | Hiring runs under the token's organization. A shell session with no credential binds to the **default** organization and lists none of those rows — a panel that is empty and gives no reason |

So `S8` owns wiring the shell's flow to resolve a principal, not merely declaring the
collections. **This is a requirement, not a reopened question** — [D4](DECISIONS.md#d4) settles
*who may read these rows*, and this settles *which organization's rows arrive*. The POC proves a
session cannot read the **wrong** organization; nothing in it proves the shell reads the
**right** one ([`poc/read-gate/`](poc/read-gate/README.md) → Limits).

**Declare the board's read with a projection, never bare.** With no `expose`, `exclude` or
`data`, the read returns the stored row unchanged
(`packages/core/src/helpers/client-projection.ts:150–158`) — for a board that is the whole task
envelope, including the execution coordinates the channel's own board action deliberately
withholds from a model: who claimed a row, its lease, its retry ledger, its write log. The
allowlist to copy already exists next to that action rather than needing to be invented
(`channelBoardRowSchema`, `packages/workforce/src/channel/channel-flow.ts`). The roster's row
carries a seat id, its flow kind, its settings bag and its instructions, and wants the same
deliberate read before it is published verbatim.

**The contested-files guardrail still holds.** `apps/kitchen-sink/fsdev.config.ts` and
`workforce/hire.ts` remain off-limits (see *At implement time*). If wiring the shell's
declaration appears to need one of them, that is a finding to raise rather than an edit to make.

## Notes from review

Inputs, not instructions. Adopt, adapt, or discard; you owe no justification for discarding one.

- Cursor: *"DOCS.md full paste — useful for review; high stale risk vs PR-C reconciliation.
  Consider shrinking to outline + must-cover bullets if the spec set feels too large."* Declined.
  The draft is what makes the reader-facing promises reviewable at all, and the stale risk is
  already answered by publishing it reconciled against the built components rather than as
  written. The dedupe pass shortened the other five documents instead.
- Cursor endorsed two rejections by name — a third-party tree ("would not remove kind grouping,
  lazy leaf fetch, or fence logic") and TanStack Query, as fighting D1. Recorded so a later reader
  does not reopen either cold.

## Follow-ups

- **The background-work panel has no bucket.** It is resource-backed (it reads a conversation's
  child sessions through package hooks) but it is not Workforce chrome and it is not item
  rendering, so [D5](../../epics/FIX-1455/DECISIONS.md#d5)'s two destinations do not cover it.
  Left where it is, with its e2e test intact. Commented **up** to the epic under
  [ER-19](../../epics/FIX-1455/BUSINESS-RULES.md) rather than answered here.
- **`routed-specialists.tsx` and `evented-actors.tsx`** share a registry filename without being
  registry items — they appear in no manifest entry. Flagged for FIX-1478, not touched here.
- **Live panels need their own tracked unit of work, and it is substrate rather than a panel
  fix.** Two people watching one board do not see each other's rows change. That is not something
  `S5` or `S6` can do better: a resource change is announced only on the stream of the execution
  that made it, and there is no cross-session fan-out of organization-scoped changes anywhere in
  the engine — the entire route surface carries two streaming routes, one per request, and one
  per user that returns 501 ([EVOLUTION.md](EVOLUTION.md) has the derivation). **Building it means
  adding a framework capability no issue currently owns**, so it is raised to be gated rather
  than absorbed here ([BP-002](../../../docs/contributing/best-practices/process.md)). Until it
  exists, the panels read on mount and a host forces a fresh read by remounting them, which
  [DOCS.md](DOCS.md) states plainly. **Do not reach for a timer instead** — the failure taxonomy
  in [BUSINESS-RULES.md](BUSINESS-RULES.md) already rules that out, and a poll would hide the gap
  rather than close it.
