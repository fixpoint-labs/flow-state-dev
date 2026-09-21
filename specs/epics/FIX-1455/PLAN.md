# FIX-1455 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

An epic plan sequences the work and says what each piece entails. It does not say how to build
any piece; that is each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n)
and [BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path: lanes against time with a now line at September 20, 2026, and a ship-fence band under the axis reading lifted. Two input lanes from other epics — the W3 floor FIX-1351, landed, and the W4 first cut FIX-1407, landed with two strays left in backlog. Then the five rows of the set, none started: FIX-1429 opens at the now line, FIX-1475 begins only after it, and FIX-1476, FIX-1477 and FIX-1478 all open at the now line beside it. FIX-1477's lane runs longest because it absorbs the other rows' surfaces as they land. The critical path runs FIX-1429 to FIX-1475 to the proof](figures/path.svg)

One hard chain and three lanes beside it. FIX-1429 is the only row that gates another, and it
gates the substance — nothing durable can be hired into a workforce the app never loads. The
three independent lanes start together at the now line; FIX-1477's runs longest because it
absorbs what the other two produce rather than waiting for it. The dependency shape itself is in
[the spec](SPEC.md#how-the-issues-flow-into-each-other); this adds time to it.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1429** serve the demo | direct → impl PR | The W3 floor · `workforce/hire.ts`, which nothing imports today | Those seats in the served flow map, over the real HTTP route of the Next-built app. Its own open question (async `fsdev.config` boot vs a post-construction `createFlowState` registry) is resolved toward durable hire | FIX-1475 | Medium |
| **FIX-1475** durable hire | spec → impl PR | FIX-1429's served workforce · the app's existing Postgres path · D2 | Runtime hire writing org-scoped durable state the next boot reloads — seats and the roster, the proof's scope ([answered](DECISIONS.md#answered-runtime-admin)). Channels and boards stay file-declared; runtime channel administration is FIX-1415's and out (ER-16) | The roster half of the rail (D7) · the epic's proof | Large |
| **FIX-1476** channels and boards | spec → impl PR | The W4 first cut (boards, inventory) · D4 · **FIX-1477's navigator**, for the channel half of the rail — **its spec must consume the D8 navigator explicitly and must not invent a `ChannelList` of its own** (D8, ER-7, ER-9) | The shipped pair — a channel kind as `flows/channels/<kind>.ts`, an instance as `CHANNEL.md` — written as real kind files, one ChannelFlow factory with dm / topic / workstream clones, boards as a bare name list, explicit per-seat drain, the unattended-board warning | The channel half of the rail · boards for FIX-1477 to render | Large |
| **FIX-1477** UI package split | spec → impl PR | D5 · D7 · D8 · FIX-1475's roster · FIX-1476's boards · the three shell figures below | Inline and resource-backed components as client-package exports; kitchen-sink consuming them; the rebuilt shell's regions — including **the one navigator the rail hosts**, parameterized by kind and deriving its depth from each flow's `cardinality` (D8), promoted out of the devtool rather than re-invented | The rebuild people can copy · **the navigator FIX-1476 fills the channel half of the rail with** | Large |
| **FIX-1478** patterns shed | spec → impl PR | D6 · the five `@flow-state-dev/patterns` imports under `flows/chat-agent/` | An audit with a Workforce path or a *keep because…* per surface; the dependency dropped if no keep-notes remain; the six-control strip's justification gone | The freed control row | Small |

**FIX-1477 owns the regions narrative, and inherits three figures with it.**
[`shell-regions.svg`](figures/shell-regions.svg) (which region reads which source),
[`shell-shed.svg`](figures/shell-shed.svg) (what the control strip and the patterns shed free)
and [`shell-narrow.svg`](figures/shell-narrow.svg) (the yielding order) are authored evidence
retained in `figures/`. They were drawn at epic altitude and belong at issue altitude: FIX-1477's
spec takes them over, redrawing rather than re-deriving. The epic keeps only
[D7](DECISIONS.md#d7)'s before/after. What the epic still fixes, and FIX-1477 consumes rather
than re-decides, is the yielding order itself ([ER-7](BUSINESS-RULES.md)) — it is a seam between
three children, not one issue's layout call.

## Where it is

Status lives in one place: [the set table in the spec](SPEC.md#the-set--as-of-2026-09-20). The
lanes above carry the same state as a picture of time and are redrawn when it moves. The two
inputs from other epics, verified 2026-09-20: **FIX-1351** (W3 floor) is Done, 19 of 20 children
Done and one Duplicate; **FIX-1407** (W4) is In Review with its first cut landed — FIX-1385,
FIX-1405 and FIX-1408 all Done — carrying only FIX-1461 (docs) and FIX-1460 (a dead-helper
decision). Neither is re-parented here (ER-17).

## What unblocks what, from here

1. **The objective is signed off** → FIX-1429 starts immediately (no spec gate, ER-20), and
   FIX-1476, FIX-1477 and FIX-1478 enter spec in parallel.
2. **FIX-1429 merges** → FIX-1475 can be specced against a workforce the app actually serves.
   Nothing else waits on it.
3. **FIX-1476 and FIX-1475 merge** → FIX-1477's resource-backed components have real collections
   to subscribe to, and the rebuilt shell can be assembled. FIX-1477 can *start* before either.
   The navigator runs the other way: **FIX-1477 ships it and FIX-1476 renders the channel half of
   the rail with it** ([D8](DECISIONS.md#d8)). That is an exchange, not a second hard chain — it
   is the arrangement [D7](DECISIONS.md#d7) already set for every shell component, so no lane
   moves in the path above. What it does change is that FIX-1476 must not ship a channel list of
   its own in the meantime.
4. **FIX-1478's audit completes** → either the dependency drops and the control strip's
   remaining rationale goes with it, or its keep-notes tell FIX-1477 which surfaces keep their
   controls.
5. **ER-22, ER-23 and ER-24 all hold** → the epic wraps. ER-24 is in the gate deliberately:
   it is the reusability claim the whole set rests on, and an epic that closed on ER-22 and
   ER-23 alone would have shipped a rebuild nobody outside kitchen-sink had ever imported.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| `apps/kitchen-sink/app/page.tsx` — the shell | FIX-1475, FIX-1476, FIX-1477 | FIX-1477 owns the regions (ER-7). The other two fill them and neither re-lays-out the rail. Three parallel rewrites of one 600-line client component is the collision to expect |
| The boot path — `fsdev.config.ts` / `createFlowState` | FIX-1429 and FIX-1475 | FIX-1429 picks the mechanism and FIX-1475 writes durable state through it. A second registration path and the roster reloads twice |
| `CHANNEL.md` frontmatter — the boards list | FIX-1476 and FIX-1477 | FIX-1476 owns the shape; FIX-1477 renders it. The UI never widens the frontmatter to make a column easier |
| The rail's navigator | FIX-1477 builds, FIX-1476 consumes | One component for both halves, depth derived from `cardinality` (D8, ER-7). FIX-1476 does **not** build a channel-only list while it waits — it builds the convention, and adopts the navigator when it lands. **Its spec names the navigator as a consumed surface**; a `ChannelList` appearing in that spec is the seam being breached at spec time, before a line is written. A second navigator is the collision to expect, and ER-9 forbids the `depth` prop that would paper over it |
| The control strip above the prompt | FIX-1478 and FIX-1477 | FIX-1478 removes what patterns backed; FIX-1477 decides what, if anything, takes the row. Whichever lands second reads the other's notes rather than re-auditing |
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

When ER-22, ER-23 and ER-24 all hold: run the lessons pass over the set's review rounds, dispatch
the docs polish over the Workforce pages the children each edited in isolation (ER-25),
**verify FIX-1372 against the rebuilt app** — the owner's triage kept it open — refresh the set
table and the path one last time, and report completion in Linear against the retained set and
the original PR. Meaningful amendments after the spec merges go through a follow-up PR from
`main`, never by reopening the original review record.
