# FIX-1720 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

When a run starts, what it runs on, what the report records, and what happens to a finding. What
each step checks, and which step each control fails, is in [PLAN.md](PLAN.md#checks). *Proved by*
names the plan step or report line that shows the rule held.

## When a run may start

| # | When | Then | Proved by |
|---|---|---|---|
| QR-1 | FIX-1621, FIX-1718 (every PR, the CoS wiring included) or FIX-1719 (both PRs) is not merged, or [D1](DECISIONS.md#d1)'s child is open, or CI is red on `main` | No run. Each blocks this issue | Linear · the report lists each merge commit |
| QR-2 | A child joins FIX-1650 mid-run, a finding included | It blocks this issue; the run in flight opens no closure PR | The epic wake |
| QR-3 | The last blocker merges | One `main` commit is picked, and every check in parts 1 to 4 runs against it | Every verdict row carries that SHA |
| QR-4 | No model key is set, or no Chromium starts | The run is *blocked*, not failed. With no browser, the check goes to `fsd-qa` over the mailbox | Report |

## What a run runs on

| # | When | Then | Proved by |
|---|---|---|---|
| QR-5 | A leg runs | Against a production build of Shift Manager from that commit, started with `--team devteam`, in real Chromium, signed in as the profile's owner. The outsider step uses the profile's third user in a second browser context | The build step; each context's user |
| QR-6 | A run starts | On a store file created for it, kept across every restart in the run and deleted after. A restart is the server process stopped and started again; a kill is `SIGKILL` | The report names the file and each restart |
| QR-7 | A CoS turn or the room's answer is graded | Once ([D2](DECISIONS.md#d2)). A miss is a finding, quoting the turn's tool calls and results by item id. A provider error re-runs that one turn and is reported | Report |
| QR-8 | Leg c boots with its cut kind | Boot 1 on a scratch patch that adds one kind; every later boot is the commit as shipped | The patch, in full, in the report |
| QR-9 | A control runs | On its own build or patch, over a fresh store. Today's `main` is the commit before FIX-1650's first child merged | Each build's SHA and patch |
| QR-10 | Any other check fails | A finding | Report |

## The plan

| # | When | Then | Proved by |
|---|---|---|---|
| QR-11 | Part 1 runs | Legs a, b and c pass, and each control fails the leg [Controls](PLAN.md#controls) names, at its step | a1 to a6, b1 to b6, c1 to c4 |
| QR-12 | Leg a grades a project | Only a row that was not in the boot's snapshot and is owned by the person. At least one lists workstreams from two teams ([D1](DECISIONS.md#d1)) | a1's row diff |
| QR-13 | A restart step runs | The page is reloaded on the new process and every earlier PASS in that leg is read again from the store | a5, b2, b4, c4 |
| QR-14 | Part 2 runs | The next-Lab journey passes with no guessed step ([D3](DECISIONS.md#d3)) | J4 |
| QR-15 | Part 3 runs | Every child's check passes with its controls failing, and every check that reads the DevTeam tree stays green | P3.1 to P3.3 |
| QR-16 | Part 4 runs | Each seam row holds, and each epic *not done if* state is shown absent | P4 |

## What the report records

| # | Section | Holds |
|---|---|---|
| QR-17 | Head | The run's number, the `main` SHA, each child's merge commit, the model and the key's provider (never the key), the store file, the Chromium version |
| QR-18 | Each step | PASS or FAIL, what the page showed, and the store read it was compared with, by id. A screenshot per leg's last step |
| QR-19 | Each CoS turn | The words sent, the session id, each tool call and result by item id |
| QR-20 | Each control | Its build or patch, the step it failed at, and the line it failed with |
| QR-21 | Each boot | Its problems list, as the server reported it |
| QR-22 | Findings | Each with its Linear id, the step it came from, and the run that retested it; a finding the owner closed, with the owner's reason quoted |

## What happens to a finding

| # | When | Then | Proved by |
|---|---|---|---|
| QR-23 | A step, a control or a part-4 row fails | Filed through `issue-manager` as a Bug (a Feature for a missing capability), under FIX-1650, blocking this issue. Every failure files one; none is folded into another's fix | Linear |
| QR-24 | A finding matches an open issue | The closure worker wires it: under FIX-1650 (or `relates-to` if it has another parent), blocking this issue | Linear |
| QR-25 | A finding is a sibling's surface (the CoS or Roster screen, a board's content, attention) | Filed on that issue's epic, not blocking this one, unless this epic's change broke it, which is this epic's | Report |
| QR-26 | A doc gap breaks no step | Filed `relates-to` FIX-1650, not blocking. One that breaks a J4 step is QR-23 | Linear |
| QR-27 | The run files anything | No PR. The row stays at `NEEDS_IMPLEMENTATION`. When the last fix merges, **the whole plan** runs again on a fresh commit | The epic wake |
| QR-28 | The owner closes a finding with a reason | The report quotes it; whoever records the drop removes the blocks relation | Report |
| QR-29 | A run files nothing | The closure PR opens with the goal check and its verdict log; its body is the report | The closure PR |

## Not done if · each state the run shows absent

| State that looks done | Absent when |
|---|---|
| A graded project was seeded, not created by CoS | QR-12 |
| No graded project spans two teams | a2 names two teams' workstreams under one CoS row |
| A project's data or conversation is in session state | a6: a talk session's state holds `resourceId` and nothing else of the project |
| PROJECTS is read from the checkout | a2 passes with no file changed and no restart since a1 |
| A fire landed without Approve, or a Deny changed something | b3 · `deny-fire` |
| A seat other than CoS hired | b6 · `no-cos` |
| A fired or retired seat is back after a restart, or still in TEAMS | b4 · c4 |
| A cut kind was mapped onto another without a person asking | c2: the seat's row unchanged before Approve |
| A step passed on a retry | QR-7: one turn per step in QR-19 |
| A control never failed, or failed at setup | Each FAIL names its leg and step, except today's `main`, whose expected red is that no CoS seat exists |

## Failure taxonomy

A check that cannot run stops the run and is reported as blocked, not failed (QR-4). A build or
boot that fails on `main` is a finding. A provider error is retried once per turn (QR-7).

## Acceptance criteria this issue owns

One run on one `main` commit files nothing, and QR-11 to QR-16 hold on it (QR-29).
