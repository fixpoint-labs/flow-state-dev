# FIX-1478 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

One predecessor: the approved epic spec retained on `main`. This issue resolves two of its
conditionals and narrows one of its figures. Nothing here supersedes it — a child discharging a
parent's condition is the parent working as designed.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| Epic D6: patterns is shed as a dependency and never bridged to seats; the dependency drops "only when no keep-notes remain" — [`../../epics/FIX-1455/DECISIONS.md#d6`](../../epics/FIX-1455/DECISIONS.md#d6) | **Retained whole.** Its conditional resolves to the keep branch | The audit found one surface — the response audit — with no team path. No seat, board or channel audits an answer, so the branch D6 wrote for this case is the one that applies | [D2](DECISIONS.md#d2): the dependency stays, scoped to that one surface, with the keep-note D6 requires | The package and its API are untouched, as D6 promised. A future team path for response auditing is the one thing that would re-open this |
| Epic SPEC, the set table: *"Is five really four?"* — collapse FIX-1478 into FIX-1477 "if the audit finds fewer than three surfaces with an honest Workforce path" — [`../../epics/FIX-1455/SPEC.md`](../../epics/FIX-1455/SPEC.md) § *The set · as of 2026-09-20* | **Discharged, not fired — by one, on a recount** | **Three** of the five pattern-backed routes have an honest team path, not four. The three and their evidence are in the table below. Three is not fewer than three | The issue stays separate, on the epic's own stated reason: its deliverable is a deletion, and deletions that ride inside a feature PR are the ones that get dropped | The epic's set table stays at five rows. No re-planning follows from this |
| Epic figure `shell-shed.svg`: FIX-1478 "owns the left half", whose on-screen half lists the six-control strip, the four-mode zoo (ask · build · interview · debate) and the thinking-style menu — [`../../epics/FIX-1455/figures/shell-shed.svg`](../../epics/FIX-1455/figures/shell-shed.svg) | **Amended in part**, for the mode zoo only. The strip and the style menu are retained as this issue's | The four modes steer prompts and import no pattern; verified against the app's mode schema and run steps. The epic's plan is the more precise statement of the same ownership — *"FIX-1478 removes what patterns backed"* ([`../../epics/FIX-1455/PLAN.md`](../../epics/FIX-1455/PLAN.md) § coordination seams) — and the figure groups by screen region, which is coarser than the code | [D3](DECISIONS.md#d3): only what a coordination pattern backs comes out | The modes keep working, unchanged. Anyone wanting them removed files it separately; it was never gated on this issue |
| Epic ER-5: one recipe per job on screen, and a kept surface "carries a written *keep because…* in its PR" — [`../../epics/FIX-1455/BUSINESS-RULES.md`](../../epics/FIX-1455/BUSINESS-RULES.md) | **Retained**, and satisfied rather than changed | The one kept surface is not a second recipe for any job the workforce does, so ER-5's *on screen* condition is met by the shed; its keep-note condition is met in the PR | [D2](DECISIONS.md#d2) supplies the note; [BR-10](BUSINESS-RULES.md) is the check that exactly one file still imports the package | None |

## The recount

The trigger turns on this table, so it carries its evidence. The bar is a **concrete shipped or
epic-promised equivalent** — a design sketch ("a coordinator seat *could* file rows") is not one.

| Route | Team equivalent | Evidence | Verdict |
|---|---|---|---|
| `supervisor` — a coordinator breaks work up, workers do it, results come back | A coordinator seat files one row per piece onto a channel's board; each row runs on the seat whose own file answers for it, in its own session; extras queue rather than being re-routed | `goals/manager-queue-lab/`, on `main`. Its exit gate `it-routes-a-queue-to-the-seats-their-files-name` runs seven legs over a real `createFlowState` host with real sessions and org-scoped storage. Also epic-promised: FIX-1476 ships "boards as a bare name list, explicit per-seat drain" ([`../../epics/FIX-1455/PLAN.md`](../../epics/FIX-1455/PLAN.md)) | **Honest path.** The review-and-replan loop is the one half nothing demonstrates |
| `routed-specialists` — named specialists contribute to shared state; a controller picks who is next | The same lab. Named builder seats settle rows on one shared board; the coordinator reads the queue view — four derived columns and a per-seat idle strip — to decide who gets what | As above | **Honest path.** The shared state is a board of rows rather than a typed document: a difference in shape, not in job |
| `plan-and-execute` — decompose a goal into steps and run them | The same lab: the coordinator decomposes the work and files it as rows | As above | **Honest path** |
| `evented-actors` — topic-matched subscriptions, cascading fan-out, a synthesizer over the chain | None | No match for `reEmit`, `watch`, `watchPattern` or `stigmerg` anywhere in `packages/workforce` or `packages/orchestration`. A channel post wakes every member — a broadcast notification, not a topic subscription, and it starts no cascade | **No path.** Shed anyway ([D1](DECISIONS.md#d1)) |
| `moderated-debate` — two positions, a moderator running rounds, a verdict | None | A channel declares exactly `flow`, `description`, `members`, `boards`, `instructions`, and that list is closed. No match for `moderat`, `round` or `turn-tak` in the workforce package or its published pages | **No path.** Shed anyway ([D1](DECISIONS.md#d1)) |

**Two things a reader should weigh.** All three survivors rest on **one** artifact — the
manager-queue lab — plus FIX-1476's promise, rather than on three independent mechanisms. And the
count is by **route**, not by file: `create-router.ts` holds two routes that split, one either
side. Counted by file the answer would be two, and the trigger would fire — but then moving
`moderated-debate` into its own pipeline file would flip the trigger while changing nothing a
person sees, which is what makes the file the wrong unit. The epic's own concern is on-screen
recipes ("a reference app teaching two recipes for one job teaches neither"), and a route is what
a person picks.

**Read the first two rows of the table above together.** D6 anticipated a keep branch and the
collapse trigger anticipated a thin issue; the audit sent one to its conditional and the other to
its negative. Both outcomes are the parent spec working, not the child departing from it. Before
implementation, re-derive the import inventory against current code rather than trusting this
table — approved intent establishes what was decided, never what currently ships ([PLAN.md → At
implement time](PLAN.md)).
