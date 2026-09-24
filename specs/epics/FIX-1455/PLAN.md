# FIX-1455 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

An epic plan sequences the work and says what each piece entails. It does not say how to build
any piece; that is each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n)
and [BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path: lanes against time with a now line at September 24, 2026, and a ship-fence band under the axis reading lifted. Two input lanes from other epics, the W3 floor FIX-1351 and the W4 first cut FIX-1407, both landed. Then seven lanes of the set, each bar running from the day Linear marked it started to the day it was done. Five are done: FIX-1429 on September 21, FIX-1476 on September 21, FIX-1475 and FIX-1478 on September 22, and FIX-1477 on September 23, the longest. Two joined the set on September 24 and are in flight, with a dashed line ahead because nothing beyond is dated: FIX-1500, the human path, started September 22 with PR-A and PR-C merged; FIX-1527, the manager seat, started September 23. A gutter mark links the two new lanes to the one open wait, the named-organization amendment that both need before a hire works in stock kitchen-sink. Below a divider, related lanes not in the set: FIX-1415, FIX-1430, FIX-1442, and FIX-1503, whose verified identity later replaces the named organization](figures/path.svg)

The first five rows are done, and the chain that held them, FIX-1429 before FIX-1475, is
satisfied. Two rows joined on 2026-09-24 under [ER-21](BUSINESS-RULES.md). **The one open wait
is the named-organization amendment** ([D9](DECISIONS.md#d9)): FIX-1500's rail hire waits on it,
and mara hires in stock kitchen-sink only once it lands. The dependency shape itself is in
[the spec](SPEC.md#how-the-issues-flow-into-each-other); this adds time to it.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1429** serve the demo | direct → impl PR | The W3 floor · `workforce/hire.ts`, which nothing imports today | Those seats in the served flow map, over the real HTTP route of the Next-built app. Its own open question (async `fsdev.config` boot vs a post-construction `createFlowState` registry) is resolved toward durable hire | FIX-1475 | Medium |
| **FIX-1475** durable hire | spec → impl PR | FIX-1429's served workforce · the app's existing Postgres path · D2 | Runtime hire writing org-scoped durable state the next boot reloads — seats and the roster, the proof's scope ([answered](DECISIONS.md#answered-runtime-admin)). Channels and boards stay file-declared; runtime channel administration is FIX-1415's and out (ER-16) | The roster and seat data FIX-1477 renders (D7) · the epic's proof | Large |
| **FIX-1476** channels and boards | spec → impl PR | The W4 first cut (boards, inventory) · D4 | The shipped pair — a channel kind as `flows/channels/<kind>.ts`, an instance as `CHANNEL.md` — written as real kind files, one ChannelFlow factory carrying the dm / topic / workstream demo channels — **how those three split across kinds and instances is bounded by what `defineChannelFlow` can build** ([recorded under D4](DECISIONS.md#custom-kind)) and is FIX-1476's spec to settle — boards as a bare name list, explicit per-seat drain, the unattended-board warning. **The convention and its data, not its rendering** — it ships no rail UI, and **its spec must say it consumes the D8 navigator rather than inventing a `ChannelList`** (D8, ER-7, ER-9) | The channels and boards FIX-1477 renders | Large |
| **FIX-1477** UI package split | spec → impl PR | D5 · D7 · D8 · FIX-1475's roster · FIX-1476's channels and boards · the three shell figures below | Inline and resource-backed components as client-package exports; kitchen-sink consuming them; **every region of the rebuilt shell, both halves of the rail included** — among them **the one navigator**, parameterized by kind and deriving its depth from each flow's `cardinality` (D8), promoted out of the devtool rather than re-invented. Ships **tenant-scoped**; org-aware listing is blocked by [FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486) (below) and is not in this row | The rebuild people can copy | Large |
| **FIX-1478** patterns shed | spec → impl PR | D6 · the five `@flow-state-dev/patterns` imports under `flows/chat-agent/` | An audit with a Workforce path or a *keep because…* per surface; the dependency dropped if no keep-notes remain; the six-control strip's justification gone | The freed control row | Small |
| **FIX-1500** the human path | spec → impl PRs | FIX-1475's roster · FIX-1477's rail and panel · D9's named organization | `createSeatHireBlocks`, `SeatDetail`, and the rail's hire door on the rail's own flow: open a seat, read its kind, hire another, find it after a restart. Skills, channels and boards on a seat are [FIX-1539](https://linear.app/fixpoint-labs/issue/FIX-1539)'s | Goal 1's acceptance run · the export FIX-1527 composes | Large |
| **FIX-1527** manager seat | spec → impl PR | FIX-1500's `createSeatHireBlocks` · FIX-1475's roster door · D9's named organization | `support.mara` on the existing `agent` kind, naming `hire` and `fire`, with seat-hire and discover composed onto that kind | A seat people copy that staffs a team | Small |

**Inherited by FIX-1477 with the navigator — implementation notes, not decisions.** They are
recorded here because they are the seam's foot-guns and its spec should not rediscover them.

- **Fetch sessions on leaf expand only.** A session list loads when a **leaf** opens — a singleton
  kind, or a collection instance — and **never** when a kind row opens. Listing sessions for every
  instance under a kind is an N+1 the moment a roster has more than a handful of seats, and a
  per-row interrupted-request sweep is the same shape wearing a different name. **This risk is new
  to this altitude**: the devtool already gates its session fetch on the active instance
  (`use-sessions` in `flow-item.tsx`), but [D8](DECISIONS.md#d8) adds the kind level *above* what
  the devtool has, so the level that can fan out did not previously exist.
- **One flow-inventory subscription, however many mounts.** If the rail mounts the navigator twice
  with different `kinds` filters, the two share a single subscription rather than each opening
  their own.
- **Centralize the session-list query semantics once.** `sessionListQuery` / `useFlow`'s session
  filter belong in `client` or `react`, with the devtool wrapping the same component — that is
  [D5](DECISIONS.md#d5)'s *ships once* read from the other side, and the alternative is a second
  public surface with the same job.
- **Stress the narrow-width latch with expand-all**, not typography: many seats under one kind,
  many sessions on one singleton kind. That is the state [D8](DECISIONS.md#d8)'s mind-changer
  turns on, and a legible collapsed rail proves nothing about it.
- **No third-party tree component.** It adds a dependency whose semantics do not match, and it
  removes none of the real work — the grouping, the lazy fetch and the shared selection.

**FIX-1477 owns the regions narrative, and inherits three figures with it.**
[`shell-regions.svg`](figures/shell-regions.svg) (which region reads which source),
[`shell-shed.svg`](figures/shell-shed.svg) (what the control strip and the patterns shed free)
and [`shell-narrow.svg`](figures/shell-narrow.svg) (the yielding order) are authored evidence
retained in `figures/`. They were drawn at epic altitude and belong at issue altitude: FIX-1477's
spec takes them over, redrawing rather than re-deriving. **`shell-regions.svg` labels the rail as
a channel list plus a seat list; that labelling predates [D8](DECISIONS.md#d8)** and FIX-1477
redraws those two as the one navigator when it takes the figure over. What the figure is evidence
*for* — that every rail region is resource-backed — is unchanged by D8, which is why it is a
redraw on handover rather than an epic-altitude edit. The epic keeps only
[D7](DECISIONS.md#d7)'s before/after. What the epic still fixes, and FIX-1477 consumes rather
than re-decides, is the yielding order itself ([ER-7](BUSINESS-RULES.md)) — it is a seam between
three children, not one issue's layout call.

## Where it is

Live status is Linear's. [The set table in the spec](SPEC.md#the-set--as-of-2026-09-24) is a
dated snapshot, and the lanes above draw that same snapshot against time. The two
inputs from other epics, re-verified 2026-09-21 and unchanged: **FIX-1351** (W3 floor) is Done,
19 of 20 children Done and one Duplicate; **FIX-1407** (W4) is In Review with its first cut
landed — FIX-1385, FIX-1405 and FIX-1408 all Done — carrying only FIX-1461 (docs) and FIX-1460
(a dead-helper decision), both still Backlog. Neither is re-parented here (ER-17).

## What unblocks what, from here

1. **The objective is signed off** → FIX-1429 starts immediately (no spec gate, ER-20), and
   FIX-1476, FIX-1477 and FIX-1478 enter spec in parallel. **Done:** FIX-1429 merged on
   [#1989](https://github.com/fixpoint-labs/flow-state-dev/pull/1989) with its goal check
   passing; FIX-1478's spec merged on
   [#1988](https://github.com/fixpoint-labs/flow-state-dev/pull/1988); and FIX-1476 and FIX-1477
   entered spec once D8 — what their specs consume — was signed off on
   [#1986](https://github.com/fixpoint-labs/flow-state-dev/pull/1986).
2. **FIX-1429 merges** → FIX-1475 can be specced against a workforce the app actually serves.
   Nothing else waits on it. **Done:** spec
   [#1990](https://github.com/fixpoint-labs/flow-state-dev/pull/1990) merged; implementing in two
   PRs, packages first.
3. **FIX-1476 and FIX-1475 merge** → FIX-1477's resource-backed components have real collections
   to subscribe to, and the rebuilt shell can be assembled. FIX-1477 can *start* before either,
   against today's shapes.
   **Rendering runs one way only.** FIX-1477 builds the navigator **and** integrates both halves
   of the rail with it, including the channel half; FIX-1476 ships the convention and the data and
   no rail UI at all. An earlier draft of this plan had FIX-1476 rendering through a component
   FIX-1477 had not shipped yet while FIX-1477 waited on FIX-1476's boards — a completion cycle,
   in which whichever finished first had to block, ship incomplete, or grow an unplanned
   follow-up. Assigning every rendering surface to one owner is what removes it, and it is the
   seam [ER-7](BUSINESS-RULES.md) already states rather than a new arrangement.
4. **FIX-1478's audit completes** → either the dependency drops and the control strip's
   remaining rationale goes with it, or its keep-notes tell FIX-1477 which surfaces keep their
   controls.
5. **The named-organization amendment merges** ([D9](DECISIONS.md#d9)) → FIX-1500's rail hire
   (PR-D) can land, and mara hires inside stock kitchen-sink rather than only under an
   authenticating app.
6. **ER-22, ER-23 and ER-24 all hold, and FIX-1500 and FIX-1527 are Done** → the epic wraps. ER-24 is in the gate deliberately:
   it is the reusability claim the whole set rests on, and an epic that closed on ER-22 and
   ER-23 alone would have shipped a rebuild nobody outside kitchen-sink had ever imported.

## The one prerequisite outside this set

**[FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486) — flow and session listing carry no
org identity.** [D8](DECISIONS.md#d8) records the evidence: the flow list is the global registry,
and session listing filters by flow, user and **tenant** — never by org. The org is missing from
the *listing shape*, not from the system: `SessionDetail` carries an `orgId` and `SessionSummary`
does not, so post-filtering would mean fetching detail per session — the N+1 the note above exists
to prevent. So the navigator FIX-1477 ships is **tenant-scoped**, and the exposure is **between
organizations inside a single tenant**, not across tenants. `DOCS.md` states that limit on the page
rather than documenting an `orgId` prop the stack cannot honour.

**FIX-1486 blocks FIX-1477's org-aware behaviour only.** The navigator itself is **not blocked** —
it ships tenant-scoped, and org scoping is added when the listing contract can carry an org.
FIX-1486 is a `Bug` against the engine/client substrate, priority High, and lives in the
**Framework simplification & cleanup** project — not this epic. It is not a child here and is not
re-parented ([ER-17](BUSINESS-RULES.md)). It sits **alongside**
[FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) (*org is never optional — require org
identity everywhere*), which is a flat related issue with no sub-issues, not a parent.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| `apps/kitchen-sink/app/page.tsx` — the shell | FIX-1475, FIX-1476, FIX-1477 | FIX-1477 owns the regions (ER-7). The other two fill them and neither re-lays-out the rail. Three parallel rewrites of one 600-line client component is the collision to expect |
| The boot path — `fsdev.config.ts` / `createFlowState` | FIX-1429, FIX-1475 and FIX-1476 | FIX-1429 picks the mechanism and FIX-1475 writes durable state through it. A second registration path and the roster reloads twice. **FIX-1475 and FIX-1476 then edit the same module-scope `await hireKitchenSinkWorkforce()` block** — seats admitted after construction, channel sessions opened — so whichever lands second rebases onto the other's org rather than introducing a second one. A rebase collision, not a scope overlap |
| `CHANNEL.md` frontmatter — the boards list | FIX-1476 and FIX-1477 | FIX-1476 owns the shape; FIX-1477 renders it. The UI never widens the frontmatter to make a column easier |
| The rail's navigator, and the channel half of the rail | FIX-1477 builds and integrates; FIX-1476 supplies | One component for both halves, depth derived from `cardinality` (D8, ER-7). **FIX-1476 ships no rail UI** — not the navigator, not a channel-only list, not a temporary one. It ships the convention and the data; FIX-1477 renders them. **Its spec names the navigator as the consumed surface**; a `ChannelList` appearing in that spec is the seam being breached before a line is written. Splitting rendering across the two is what created a completion cycle in an earlier draft, and a second navigator is still the collision to expect — ER-9 forbids the `depth` prop that would paper over it |
| The control strip above the prompt | FIX-1478 and FIX-1477 | FIX-1478 removes what patterns backed; FIX-1477 decides what, if anything, takes the row. Whichever lands second reads the other's notes rather than re-auditing |
| `apps/kitchen-sink/workforce/hire.ts` — the seat-hire options | FIX-1500 and FIX-1527 | **FIX-1500 owns `createSeatHireBlocks` and the rail's hire door; FIX-1527 owns mara's composition on the `agent` kind.** Both read **one** seat-hire options object in `hire.ts`. A second object hires a different `agent` kind, which `hire.ts` already warns against. The named organization both hire into is [D9](DECISIONS.md#d9)'s, specced in their shared amendment |
| The Workforce docs pages | FIX-1475, FIX-1476, FIX-1477 | All three will touch them. Whichever lands second links rather than repeats; the wrap's docs polish reconciles (ER-25) |

## Not children, deliberately

[FIX-1415](https://linear.app/fixpoint-labs/issue/FIX-1415) (runtime channel-admin verbs,
parked) · [FIX-1430](https://linear.app/fixpoint-labs/issue/FIX-1430) (manager-queue lab —
consumed as a POC spine for board → seat routing, W4-side) ·
[FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442) (org never optional, soft-related) ·
[FIX-1351](https://linear.app/fixpoint-labs/issue/FIX-1351) and
[FIX-1407](https://linear.app/fixpoint-labs/issue/FIX-1407) (the inputs). Linked from the rules,
never re-parented (ER-17).

The five soft-noted stale tickets are **not children**, and their triage is
[answered](DECISIONS.md#answered-stale): FIX-1372 stays open and is verified against the rebuilt
app at wrap; FIX-420, FIX-429, FIX-472 and FIX-540 close as superseded by this set. The Linear
triage itself is PM/LM's — no child edits those five.

## Wrap

When ER-22, ER-23 and ER-24 all hold and every row is Done: run the lessons pass over the set's review rounds, dispatch
the docs polish over the Workforce pages the children each edited in isolation (ER-25),
**verify FIX-1372 against the rebuilt app** — the owner's triage kept it open — refresh the set
table and the path one last time, and report completion in Linear against the retained set and
the original PR. Meaningful amendments after the spec merges go through a follow-up PR from
`main`, never by reopening the original review record.
