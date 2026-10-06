# FIX-1649 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1477 D1: the navigator and panels ship from `@flow-state-dev/react` with no CSS framework, themed through custom properties and slots; source [`../../issues/FIX-1477/DECISIONS.md#d1`](../../issues/FIX-1477/DECISIONS.md#d1), with BR-17 in its `BUSINESS-RULES.md` | **Retained** | `--fsd-nav-*` and `--fsd-panel-*` are read in `packages/react/src/components` on `main`, and kitchen-sink's `app/page.tsx` maps its tokens onto them | This epic's D2 and ER-2 consume the contract; FIX-1655 maps one token set onto it. D1's rejection of the copy-in registry *for the chrome* also stands: the chrome is imported from `react`, and publishing `ui` as a runtime package is not reopened | No prop or property is renamed; existing hosts keep their own mapping |
| FIX-1455 D5: a component ships once, from its one package; Labs import it, never copy it; no third Workforce UI package; source [`../FIX-1455/DECISIONS.md#d5`](../FIX-1455/DECISIONS.md#d5) | **Retained** | App Lab imports the react chrome and takes generic rendering from the `ui` registry by `fsdev ui add`, the route D5 already gives kitchen-sink; the design-system package holds the App Lab theme, not Workforce UI | ER-6 (unedited copies, re-synced), ER-7 | None: [D3](DECISIONS.md#d3) chose one app, so no chrome package amends D5 |
| FIX-1455 D3: seat, kind and agent, and none of them L1; source [`../FIX-1455/DECISIONS.md#d3`](../FIX-1455/DECISIONS.md#d3) | **Retained** | The Architect's vocabulary on FIX-1649 restates it | ER-7, ER-8 | None |
| D-12: Conductor retired, DevForce is a Lab built completely on Workforce; provenance [FIX-1410](https://linear.app/fixpoint-labs/issue/FIX-1410) (Done), restated on FIX-1649 | **Retained** | `labs/conductor` remains in the repo as incubation; this epic revives no factory shell around it | ER-8; [D3](DECISIONS.md#d3) reads "a Lab" as a Workforce tree | `labs/conductor` is untouched |

No predecessor is superseded. Kitchen-sink's shell (FIX-1455, FIX-1592) stays the teach
surface; App Lab is beside it, not in place of it. Re-check each cited intention against
current code before implementing.

<a name="amendment--2026-10-01--design-v2s-structure"></a>
## Amendment · 2026-10-01 · design v2's structure

Design pass 2 came back as v2, Jake's final hand-back
([PR #2605](https://github.com/fixpoint-labs/flow-state-dev/blob/fa1b85160b477ea7d58b73da3f6e2cc051914c87/specs/epics/FIX-1649/assets/design/v2/README.md#where-v2s-structure-differs-from-v1)).
It moves sidebar sections, tabs and the landing screen, which
[ER-10](BUSINESS-RULES.md#how-the-set-is-run) makes an epic amendment. Jake's call on
2026-10-01: handle Chief of Staff and Roster in this epic, not as a follow-up. This set was
merged on [#2421](https://github.com/fixpoint-labs/flow-state-dev/pull/2421); that PR stays the
review record.

| Prior intent in this set | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The first screen is the sidebar's Inbox; the sidebar is org switcher, Jump to, Inbox, Tasks, PROJECTS, TEAMS ([DECISIONS → decided in review](DECISIONS.md#decided-in-review-recorded-so-no-child-reopens-them), ER-1) | **Amended** | v2 makes Chief of Staff the default screen and adds Roster | Chief of Staff, the landing view, is FIX-1722; Roster is FIX-1723; ER-1 lists both | `/inbox` and `/tasks` keep their routes; Inbox stops being the default |
| TEAMS lists each team's workers below it, Jake's correction on v1, held open in [design pass 2](DECISIONS.md#design-pass-2) until this amendment | **Superseded** | v2 answers the correction with a screen: a row of status squares per team, opening Roster filtered to it | FIX-1723's TEAMS decision; the worker list moves to Roster. A worker's status reads on shift, on call or off shift; *working / waiting on you / idle* is retired | Each square still stands for one seat and names it on hover, so the closure keeps a per-seat read |
| A worker's status is Workforce's as shipped ([who owns what](DECISIONS.md#who-owns-what)) | **Amended** | Roster needs one status every screen agrees on | FIX-1723 derives it in Shift Manager from board rows and pending asks; seat data, the CoS and Ops seats and the inventory Roster reads are FIX-1719's (FIX-1650 epic) | No field in Workforce; nothing in Core or Engine (ER-7) |
| The theme has a light and a dark variant (decided in review) | **Retained**, plus a live switch | v2 puts a Day shift / Night shift switch in the sidebar | FIX-1725, look only; it never swaps the Lab tree | The variants and leg c are unchanged |
| D1 split the shell at the task level only | **Amended** | Its split trigger (a part with reads of its own) fired for Chief of Staff and Roster | D1 names FIX-1722 and FIX-1723 as children inside FIX-1662's frame | FIX-1662 shipped; neither reopens it |
| Three centre levels, each with four tabs, and the task's Open PR, the workstream's Pause stream, the project's + Team and + Workstream (decided in review, ER-1) | **Retained: v2's removal not adopted** | Out of scope for this amendment; the shell keeps those surfaces, and FIX-1662 already ships them | None | No route or tab is removed |

The closure, FIX-1663, now runs after FIX-1722, FIX-1723 and FIX-1725 as well: Linear has all
three blocking it as whole issues. Within FIX-1722, only its ON CALL rail waits on FIX-1723. v2's look (ER-9's final values) lands on #2605, not here.

<a name="amendment--2026-10-02--v2s-look"></a>
## Amendment · 2026-10-02 · v2's look

Jake asked whether this epic aims to deliver v2's theme and base UI in full. An audit of the
shipped shell against v2 on `main` at `48c31cfa6`
([`../../issues/FIX-1737/assets/GAPS.md`](../../issues/FIX-1737/assets/GAPS.md)) found 110 gaps:
40 look, 11 layout, 59 content. 56 need no sibling's data, and no existing check would notice any
look or layout gap. The answer adopted: yes, for everything not blocked on sibling data. This set
was merged on [#2421](https://github.com/fixpoint-labs/flow-state-dev/pull/2421), which stays the
review record, and amended once since.

| Prior intent in this set | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| *"v2's look (ER-9's final values) lands on #2605, not here"* ([the 2026-10-01 amendment](#amendment--2026-10-01--design-v2s-structure)); ER-9 read as the theme's token values | **Amended** | Values alone left the fonts unloaded, no monospace meta, a sidebar lighter than the page, rounded corners and the highlighter on one screen (GAPS.md summary 1–5) | [ER-16](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt): v2's look on every screen, with three named exemptions. FIX-1736 (fonts, direct route) and FIX-1737 (the other 53 drawable rows, four PRs) join the set | The theme's values, leg c and the switch are unchanged; no route, tab or action moves |
| The epic goal and ER-13: legs a, b and c ([SPEC](SPEC.md#the-goal-and-how-well-know-its-met)) | **Amended** | No leg read the look against v2; the look goal grades whose values paint, not where | Leg d: FIX-1737's `goals/shift-manager/it-draws-v2s-look/` on the closure commit over the DevForce tree, day and night, with its `drift`, `unclassified` and `missing` controls. FIX-1663's plan runs all three | Legs a to c and their controls unchanged |
| The footer *"with the sessions live and the user"* ([decided in review](DECISIONS.md#decided-in-review-recorded-so-no-child-reopens-them)) | **Amended** | v2 draws the on-shift and on-call counts and the user's initials (v2:107-111); audit row F22 | FIX-1737's slice B draws v2's footer and updates the checks that pin the old one | Shift Manager's README already describes the footer as counts |
| ER-6: a registry part that can't take the skin is fixed at its source by FIX-1655 | **Retained**, owner open | FIX-1655 is Done; the ask card's filled Reject and the cards' layout differ from v2 | FIX-1737's spec asks Jake: name them as exceptions in the leg d check, or file a child for the registry source | No registry copy is edited either way |

Out of this amendment, and staying with their owners: rows waiting on FIX-1650, 1651 or 1652
data (54 rows, some only in part), FIX-1675's watches and FIX-1474's also-post, and the v1
structure the 2026-10-01 amendment kept (X1 to X7). FIX-1736 and FIX-1737 block FIX-1663 in
Linear.

<a name="amendment--2026-10-04--wrap"></a>
## Amendment · 2026-10-04 · wrap

The closure, FIX-1663, merged on [#2709](https://github.com/fixpoint-labs/flow-state-dev/pull/2709)
(`894c418d2`) after a clean run on `01444863c`: every leg and part passed, and every control was
right. Its goal check,
[`goal.md`](../../../goals/shift-manager/a-lab-is-worked-through-one-skinned-shell/goal.md) with
`legs.mts` beside it, is the one home for how legs a to c are checked, as `it-draws-v2s-look/` is for leg d. Two calls were made during the
closure; they are recorded here so no later Lab reopens them. The review records stay
[#2421](https://github.com/fixpoint-labs/flow-state-dev/pull/2421) and the two amendments above.

| Prior intent in this set | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| *"Leg c's sweep, pinned once"*: the react chrome App Lab mounts (navigator, roster, board panels, seat detail), every registry component App Lab copies, the devtool page ([SPEC](SPEC.md#the-goal-and-how-well-know-its-met)) | **Amended**, narrowed to what Shift Manager draws | Shift Manager mounts no `@flow-state-dev/react` chrome; it imports providers, hooks and the item renderer from it, no chrome component. FIX-1663 narrowed its own plan after closure run 1 at `899e059` (EM call with FIX-1688 and FIX-1689, [#2532](https://github.com/fixpoint-labs/flow-state-dev/pull/2532)) and left this text to the wrap ([FIX-1663's evolution](../../issues/FIX-1663/EVOLUTION.md)) | Leg c sweeps the registry cards Shift Manager draws and the devtool page, not react chrome: [SPEC goal §](SPEC.md#the-goal-and-how-well-know-its-met) + [`goal.md`](../../../goals/shift-manager/a-lab-is-worked-through-one-skinned-shell/goal.md) | ER-2, ER-3 and the theme's value list are unchanged. [D2](DECISIONS.md#d2)'s two shelves stay the contract a host may use; Shift Manager uses the registry shelf only |
| Leg c's control: *"one reused component given a hardcoded App Lab colour: leg c must FAIL naming it"* ([SPEC](SPEC.md#the-goal-and-how-well-know-its-met), ER-13) | **Amended**, named | `hardcoded-accent` patches the tool card's copy; on `01444863c` it failed at `c:tool` only. FIX-1664's `worker-session` points the run-lab's Session, where leg c draws four of its parts, elsewhere, so goal.md lets it turn `c:sweep` red beside its `a2` | Each control fails at its own signal only, as the closure check grades it: [SPEC goal §](SPEC.md#the-goal-and-how-well-know-its-met) + [`goal.md`](../../../goals/shift-manager/a-lab-is-worked-through-one-skinned-shell/goal.md) | The control's patch and the theme values are unchanged |
| Leg a's Inbox journey: the ask *"in Inbox with its kind and workstream"*, its card *"in the workstream's stream"*, read as the asking seat's first channel ([SPEC](SPEC.md#the-goal-and-how-well-know-its-met)) | **Amended**, the reading only | Once FIX-1718 put `eng.em` in four channels, Inbox named all four for an ask with no workstream session, and the specs left that case open (the run on `dd9054581` was red at a1 alone). What shipped, and was decided for the closure on 2026-10-04 as right: FIX-1662's [BR-18](../../issues/FIX-1662/BUSINESS-RULES.md) draws an ask's card on the Stream of every channel that has its seat as a member (`asksFor()`), whether or not a post started it; Inbox names the channel whose post started the ask, and otherwise every channel the seat is in (`workstreamsOf()`) ([`6c6030939`](https://github.com/fixpoint-labs/flow-state-dev/commit/6c6030939)) | a1 reads its expected workstreams from the store as Inbox does, holds Inbox to exactly that set, and checks the card on each Stream in it. For an ask a post started, that set is the parent channel only, so a1 proves the parent Stream and not the seat's other channels' Streams. Checking every member Stream is an open follow-up, rolled into the goals/lib helper fold: [SPEC goal §](SPEC.md#the-goal-and-how-well-know-its-met) + [`goal.md`](../../../goals/shift-manager/a-lab-is-worked-through-one-skinned-shell/goal.md) | BR-18, `asksFor()` and Inbox are unchanged; the closure's ask had no parent, so a1 checked all four Streams |
| ER-15: no child writes into a worker's session except through its shipped operations ([BUSINESS-RULES](BUSINESS-RULES.md#what-no-child-may-do)) | **Amended**, narrowly | FIX-1718 and FIX-1752 added two writes part 4 did not name: `sendAction(` in `labs/shift-manager/src/lib/talk.ts` and `createSession(` in `lib/reads.ts`. Both write the person's own sessions on `ROOM_KIND`, never a worker's. Decided for the closure on 2026-10-04 ([`c59c57491`](https://github.com/fixpoint-labs/flow-state-dev/commit/c59c57491)) | The two room-kind writes, as [ER-15](BUSINESS-RULES.md#what-no-child-may-do) states them; part 4 grades them: [SPEC goal §](SPEC.md#the-goal-and-how-well-know-its-met) + [`goal.md`](../../../goals/shift-manager/a-lab-is-worked-through-one-skinned-shell/goal.md) | No new write into a worker's session; ER-15's other doors and its owner are unchanged |

[The path](PLAN.md#the-path) is redrawn as it shipped. The set table stays the 30 September
snapshot; live state is Linear and the implementation PRs.
