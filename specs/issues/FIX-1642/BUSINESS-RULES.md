# FIX-1642 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

When the run starts, what it runs on, and what it does with findings. What each leg checks,
and which legs each control fails, is in [PLAN.md](PLAN.md#checks). *Proved by* names the plan
step or report line that shows the rule held.

## When a run may start

| # | When | Then | Proved by |
|---|---|---|---|
| QR-1 | Any issue Linear lists as blocking FIX-1642 is open, or CI is red on `main` | No run. The list is read from Linear at run time, not from the epic's set table; the owner may move the wake POCs out of the epic, and then they stop blocking. It is read again after part 4, immediately before the closure PR opens | The report quotes the blocked-by list it read both times, with each issue's state |
| QR-2 | A child joins the epic mid-run | It blocks this issue. The re-read before the PR finds it open, and the run in flight opens no closure PR | The second blocked-by read in the report |
| QR-3 | The start conditions hold | One `main` commit is picked, and every check in parts 1 to 4 runs against it | Every verdict row carries that SHA |

## What a run runs on

| # | When | Then | Proved by |
|---|---|---|---|
| QR-4 | The reader leg runs | Against the docs site built from that commit and served locally, and the shipped packages packed from it and installed into a scratch project outside the workspace | The build and pack steps |
| QR-5 | The reader works | It gets the site's root URL, the app brief and the scratch project. It reads nothing under `node_modules`, the workspace or the web beyond the local site, and no page more than one link from the page. Its transcript is kept | The transcript audit ([D1](DECISIONS.md#d1)) |
| QR-6 | The audit finds a forbidden read | The run is void, not failed: it proves nothing either way, and runs again with a new reader | Report |
| QR-7 | The reader cannot continue without something the page doesn't say | It logs the gap and stops that part. Each entry in its gap log is a finding | The gap log in the report |
| QR-8 | The fence leg runs | On a real Redis, on the reader's own fixture host: `dispatch-only` with a separate worker process. Redis absent fails the run; it is never skipped | Leg D's rows |
| QR-9 | Anything calls the fixture | Over HTTP, as a caller would: a webhook signed as its provider signs it, a schedule tick with the scheduler's secret, never a `userId` in the body (project PR-1) | Legs B and C |
| QR-10 | No provider key is set | The fixture runs anyway; it uses no model | Leg B |

## The plan

| # | When | Then | Proved by |
|---|---|---|---|
| QR-11 | Part 1 runs | The reader builds the fixture from the page; legs A to D pass; each control fails its own leg and names its claim | A to D, [Controls](PLAN.md#controls) |
| QR-12 | A name on the page resolves only in a flat lookup, not on the type it is passed to | A finding | Leg C |
| QR-13 | The page's fence says one thing and a mode does another | A finding against the page, never a change to the runtime (epic ER-6). If FIX-1634 has shipped and the page still states the refusal, the finding is FIX-1634's docs work (epic ER-14) | Leg D |
| QR-14 | Part 2 runs | The terms and channel-or-board journeys pass | J1, J2 |
| QR-15 | Part 3 runs | FIX-1639's check is skipped where part 1 walks it; only the parts the reader leg doesn't reach are re-run, if any. Any other child Linear lists as merged and blocking has its check re-run; canceled ones have none | [Part 3](PLAN.md#checks) |
| QR-16 | Part 4 runs | Its four checks hold. Term disagreements are reported as contradictions only | [Part 4](PLAN.md#part-4--gap-sweep) |

## What happens to a finding

| # | When | Then | Proved by |
|---|---|---|---|
| QR-17 | A check fails, or the reader logs a gap | Filed through `issue-manager` as a Bug (a Feature when the fix is missing capability), parented under FIX-1637 and blocking this issue. A page defect is fixed on the page by its own route, never in the closure PR | The Linear link in the report |
| QR-18 | The finding matches an open issue | The worker wires that issue itself: parented under the epic (or `relates-to` if it has another parent) and blocking this one | Linear |
| QR-19 | A run files a finding | No PR. The row stays at `NEEDS_IMPLEMENTATION`, and when the last finding merges the whole plan runs again on a fresh commit | The status line |
| QR-20 | The owner closes a finding with a reason | The report quotes it, and whoever records the drop removes its block on this issue | Report · Linear |
| QR-21 | Something outside the epic's goal breaks | Filed normally, not under the epic | Report |
| QR-22 | A run files nothing | The closure PR: the goal check and its fixture, the CI scan step, and the QA report as its body, naming the commit and each check's PASS and each control's FAIL | The PR |
