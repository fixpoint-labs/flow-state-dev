# FIX-1737 · Rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

Row IDs (F2, K8…) are the audit's, [`assets/GAPS.md`](assets/GAPS.md). "v2" is
[`shift-manager-v2.dc.html`](../../epics/FIX-1649/assets/design/v2/shift-manager-v2.dc.html);
each look-table row cites its line. *Probe* is the goal check, `it-draws-v2s-look`.

## Scope

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | An audit row's Needs is "—" | It is drawn here, in the slice PLAN names, except F1 (FIX-1736) and T4, T6 (registry) | `poc/scope/check.mjs`: 53 rows, all classified, planted row fails |
| BR-2 | A row waits on a sibling, even in part | Not drawn here; its named empty state stays as shipped | The scope check: no blocked row in a slice |
| BR-3 | An in-scope row includes an avatar, slot pips or capacity (W5, P2) | That piece waits with F6 or FIX-1719; the rest of the row is drawn | Probe: the row's look-table entry omits it |
| BR-4 | A row would move a level, section, tab or the right panel's content | It is not this issue's; it goes to the epic (ER-10). None of the 53 does | Spec review |

## The look, everywhere

| # | When | Then | Proved by |
|---|---|---|---|
| BR-5 | Any screen renders, day or night | Both Space Grotesk and IBM Plex Mono are loaded, not only named | Probe, **type** |
| BR-6 | Text is a label, count, id, time, meta line or button (v2's mono roles) | IBM Plex Mono at v2's size | Probe, **type** |
| BR-7 | A screen has a title | v2's scale: 18/700 on most, 22 on Chief of Staff, 26 on Inbox's detail | Probe, **type** |
| BR-8 | Any element outside the registry list renders | Radius 0, including shell classes that bypass the token | Probe, **surface** |
| BR-9 | The sidebar, a right rail or Inbox's detail renders | On v2's sidebar or inspector surface, darker than the page in both shifts | Probe, **surface**; token test |
| BR-10 | Something waits on a person (an ask, a needs-you count, a NEEDS YOU tag, a needs-you dot) | It carries the highlighter, and nothing else does | Probe, **marks**, both directions |
| BR-11 | A task's state is shown anywhere in scope | v2's state square for it: needs, run, review, queued, done | Probe, **marks** |
| BR-12 | The window is 1180px wide or more | Sidebar 248px, right rail 340px, Inbox list 400px | Probe, **layout** |
| BR-13 | The window is narrower than 1180px | The right rail drops; the page holds a 900px minimum | Probe, **layout** at 1100px |

## Content drawn now

| # | When | Then | Proved by |
|---|---|---|---|
| BR-14 | Tasks renders | ID and TIME columns in v2's order; TIME is elapsed from the row's start; queued hidden by default with its count | Probe, **content**, against the store |
| BR-15 | A workstream's board renders | Columns QUEUED, RUNNING, IN REVIEW, NEEDS YOU, DONE; DONE as one-line rows | Probe, **content**; `columns.test.ts` gains order |
| BR-16 | A stream has a pending ask | The ask sits in the feed at its time, not in a side column; answering clears Inbox too | `it-opens-a-lab` *answer*, updated |
| BR-17 | A task's session holds a pending ask | The ask card shows inline, through the one ask rendering | `it-hands-a-run…`, updated |
| BR-18 | Inbox selects an ask | *From the session*: the session's last three tool calls before it | Probe, **content**, against the store |
| BR-19 | Nothing waits in Inbox | v2's sentence, with the live sessions and on-call counts | `it-opens-a-lab` `inbox-empty`, updated |

## Registry parts

<a name="registry-parts"></a>

| # | When | Then | Proved by |
|---|---|---|---|
| BR-20 | A registry copy renders (ask card buttons, message, reasoning, tool, code block cards) | Unedited. Its radius is graded only where the theme's radius reaches it; what can't is listed by name in the probe's exceptions | Probe; `test/static.test.ts` |
| BR-21 | The probe meets an element on the exceptions list | Skips its radius and colour-role rows only; fonts and highlighter still graded | Probe |
| BR-21b | A look-table row matches fewer elements than its expected count | The check fails at that row, naming it: an element that went missing is a failure | Probe, control `missing` |

## Checks that pin copy

The boundary: the probe grades the visible DOM against the store; the behaviour goals grade reach
and interaction. A row in both is asserted once by each, for its own reason.

| # | When | Then | Proved by |
|---|---|---|---|
| BR-22 | A slice changes copy or a test id a behaviour check pins (F22, I3, I8, I18, K1, K4, K5, R6, W11, W12, T7) | That check is updated in the same PR, asserts the same intent, and still fails under its control | The check's control run, in the PR |

**Failure taxonomy.** Nothing here is a runtime failure path: the rows are look. A probe failure
is a defect in the slice that owns the screen. A font that fails to load is FIX-1736's regression
and fails **type** everywhere. A screen the Lab can't populate (no live run) is a setup failure,
never a pass.

**Acceptance this issue owns.** The 53 rows are drawn to v2; the probe passes on the assembled
set in both shifts and both widths, with both controls failing as named; every updated behaviour
check passes with its control failing.
