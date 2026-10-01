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
