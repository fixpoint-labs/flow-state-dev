# FIX-1887 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

When a run may start, what it runs on, what counts, and what happens to a finding. What each
part checks is in [PLAN.md](PLAN.md). The states a run shows absent are SPEC's
[*not done if*](SPEC.md#the-goal-and-how-well-know-its-met). *Proved by* names where the report
shows the rule held.

## When a run may start

| # | When | Then | Proved by |
|---|---|---|---|
| CR-1 | Any other child of FIX-1870 is not merged: every PR of FIX-1875 (P1, P2), FIX-1872 and FIX-1876 (P1 to P3) | No run. Each blocks this issue in Linear | The report lists each merge commit |
| CR-2 | A child joins FIX-1870 while a run is in flight, a finding included | It blocks this issue (the closure rule); the run in flight opens no PR | The epic wake |
| CR-3 | CR-1 holds and CI is green on `main` | One `main` commit is checked out clean, and every part runs against it. A dirty tree, or a part that finds a different `HEAD`, stops the run | Every verdict line carries that SHA |
| CR-4 | No key serves the model | The run is *blocked*, not failed | Report |
| CR-5 | Someone wants the check outside a closure | On demand only, never a CI gate: it rests on a real model. The two scripts alone need no model, and a child may run them any time | `goal.md` |

## What a run runs on

| # | When | Then | Proved by |
|---|---|---|---|
| CR-6 | Any composed check runs | As its own process, with its own setup, store and `GOAL_CONTROL`, exactly as its `goal.md` says. The runner edits none of them | The runner's command list |
| CR-7 | A composed check documents controls | Each runs, and goes red at exactly its documented tags plus its documented co-failures. One that passes, fails at setup, or reddens another tag is a finding against the control | Each verdict line |
| CR-8 | A model step misses | The composed check's own attempt cap applies (`GOAL_ATTEMPTS`). Every attempt is in the report | Report |
| CR-9 | The sweep runs | At the commit and at the control commit: the first parent of the merge of FIX-1875's first PR | Both SHAs in the report |
| CR-10 | The rename-map script runs | Over each child merge's diff to the six checks and FIX-1872 V9's reruns, from the merge's first parent ([D3](DECISIONS.md#d3)), after `--sources` agrees with the children's tables and `--control` catches every plant | Its three outputs in the report |

## What counts as only names

| # | When | Then | Proved by |
|---|---|---|---|
| CR-11 | A hunk in any of the six checks changes | Both sides are cut into tokens, whitespace ignored. Every differing token pair is a map pair, the *Ask* → *Wait* family FIX-1876's table names, or an article agreeing with its renamed noun. Otherwise the hunk fails ([D2](DECISIONS.md#d2)) | `map:` |
| CR-12 | A hunk adds or drops a token | It fails, unless a shape entry or a listed fence line below explains it | `map:` |
| CR-13 | A coordinator check moves the post entry from `internal` to `task`, or turns `handOff({ worker })` into `dispatchTask({ post: true, assignee })` | Admitted as #3153's two named entries. In the three regression checks the same change fails ([ER-11](../../epics/FIX-1870/BUSINESS-RULES.md#what-no-child-may-do)) | `map:` |
| CR-14 | A coordinator check replaces a ledger read with a row read | Admitted only when listed in the script's fence file with its path, its replacement and the reason, and only in a coordinator check. Only that line and its replacement are exempt; the rest of the hunk is judged by CR-11. The report prints each one. An outcome line (what the person sees) never changes | The fence list in the report |
| CR-15 | A child's pinned table and the script's map disagree, either way | `--sources` fails, and the run stops before the diff is judged | `--sources` |

## What counts as gone

| # | When | Then | Proved by |
|---|---|---|---|
| CR-16 | A retired name appears in package source, a package README, a published page, a team's worker file or the reference app | A live hit, unless the line carries `retired-name-refusal` (a refusal of the old name, or a legacy reader) | `sweep:` |
| CR-17 | An exported symbol or a tool name names `waitForResponse`, `timeoutMs` on `addTask`, `handOff`, or a public ask name FIX-1875 retires | A live hit, read from source: a tool's name is a string literal, a key constant or a worker file's `tools:` line, and an export names its symbol. What the built packages refuse is the children's: FIX-1875 V6 (`waitForResponse`, `timeoutMs`), FIX-1872 BR-18 and its V7 (`handOff`), FIX-1872 leg b (no ledger) | `sweep:`, and those checks cited |

## What happens to a finding

| # | When | Then | Proved by |
|---|---|---|---|
| CR-18 | A check, a control, the script, the sweep or a gap-sweep line fails | Filed through `issue-manager` as a Bug (a Feature for a missing capability), under FIX-1870, blocking this issue | Linear |
| CR-19 | A finding matches an open issue | The closure worker wires it: under FIX-1870 (or `relates-to` if it has another parent), blocking this issue | Linear |
| CR-20 | A regression check cannot pass without a change beyond names | The kill line: the finding is raised at the epic as one, never fixed by editing the check | The epic's status |
| CR-21 | The run files anything | No PR. The row stays at `NEEDS_IMPLEMENTATION`. When the last fix merges, **the whole plan** runs again on a fresh commit | The epic wake |
| CR-22 | The owner closes a finding with a reason | The report quotes it, and whoever records the drop removes its blocks relation | Report |
| CR-23 | A run files nothing | The closure PR opens: the goal directory, with the report as its body. No changeset, no product code, no edit to a composed check | The closure PR |

## Failure taxonomy

A check that cannot start is *blocked*, not failed (CR-4). A server that will not boot on the
commit is a finding. A model miss is retried within the composed check's own cap (CR-8). A
control that fails at setup is a finding against the control, never a pass. A script that
cannot read its sources (a child's table moved) is a finding against the script, fixed in this
issue, since the scripts are its own.

## Acceptance criteria this issue owns

One run on one `main` commit files nothing: every composed check passes and each of its
controls fails as documented, the rename-map script explains every hunk and catches every
plant, the sweep finds no live line at the commit and fails at the control commit, and every
gap-sweep line holds (CR-23).
