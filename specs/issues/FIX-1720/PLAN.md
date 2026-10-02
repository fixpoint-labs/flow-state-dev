# FIX-1720 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md)

Written for the closure worker, which owns the step definitions. It starts when QR-1 holds, and
adds only the goal check. Names from the children are read off their **merged** specs on `main`
and their shipped code (FIX-1621, FIX-1718, FIX-1719, and FIX-1722 and FIX-1723 for the Chief of
Staff view and TEAMS). Where a merged spec or the code renames something below, that name wins.

## Surfaces

| ID | Where | Change |
|---|---|---|
| S1 | `goals/shift-manager/one-person-runs-a-labs-projects-and-people/` | `goal.md` from [SPEC.md's goal](SPEC.md#the-goal-and-how-well-know-its-met) in the `goals/README.md` format, stating the on-demand posture (QR-5). `run.mts` is a thin orchestrator: it builds Shift Manager once, then runs `legs/a.mts`, `legs/b.mts`, `legs/c.mts`, the controls, J4, the part-3 manifest and the part-4 assertions, and writes the report |
| S2 | `goals/lib` | The shared harness the legs use: start, stop and restart Shift Manager over a run-scoped store; open a browser context per user; read the store through the Lab's routes. Promoted from `it-opens-a-lab` and `it-briefs-and-talks-with-the-chief-of-staff` where they hold it, never copied or imported across goal directories |
| S3 | `controls/` under S1 | The scratch patches: `extra-kind` (leg c's boot 1), `no-cos`, `no-tool`. Each applied to a copy of the commit, never committed, printed in full in the report. `deny-fire` is a click, not a patch |
| S4 | Part 3's manifest, under S1 | A list of child goal paths, each with the controls this run still owes it ([Part 3](#part-3--every-childs-check)). Each runs as its own subprocess, its verdict collected into the report |
| S5 | J4's scratch copy | A copy of `goals/pentest-lab/lab/` that [D3](DECISIONS.md#d3)'s writer edits; deleted after the run |
| S6 | The closure PR | Only after a run that files nothing: S1 to S4 with the verdict log, the report as its body. No changeset |

## Sequence

```mermaid
flowchart TD
  M["QR-1 holds · pick the commit"] --> B["build Shift Manager"]
  B --> A["leg a · CoS creates two projects · restart"]
  A --> L2["leg b · hire, fire on Approve · restarts"]
  B --> C1["leg c · boot 1 with extra-kind · hire on it"]
  C1 --> C2["boot 2 and 3 as shipped · name, retire, start clean"]
  L2 --> K["controls · each on a fresh store"]
  C2 --> K
  T["today's main · its own build"] -.->|"a control"| K
  K --> J["part 2 · J4 · the next Lab from the docs"]
  J --> P3["part 3 · the manifest, green paths"]
  P3 --> P4["part 4 · scripted seam assertions"]
  P4 -->|"findings"| F["file each, blocking FIX-1720 · stop"]
  P4 -->|"none"| PR["closure PR with the report"]
```

Legs a and b share one store and one server; leg c runs on its own store, because its boot 1 is
a patched build.

## Checks

Every row read on the page is compared by id with what the store returns through the Lab's
routes, never with Shift Manager's state. Names marked *held-out* are picked at run time.
The person is the profile's owner; the second member and the outsider are its other two users.

| ID | Passes when |
|---|---|
| a1 | **Ask for two projects.** In the Chief of Staff view, the person asks CoS for project P1 (held-out title) holding [D1](DECISIONS.md#d1)'s two workstreams, one per team, members the person and the second member, and P2 (held-out title) with none. CoS's session holds two `createProject` calls with ok results; the `projects` rows not in the boot's snapshot are exactly P1 and P2, owned by the person, each with the person's talk session in `sessions`. D1's workstreams missing or already claimed at boot is a finding against FIX-1718 |
| a2 | **PROJECTS.** Lists P1 and P2 by title among the store's rows; beneath P1, exactly its two workstreams, from two teams; the defaults are unchanged; no restart and no file change between a1 and a2 |
| a3 | **Four tabs, each project.** Brief equals the row's brief. Workstreams lists the row's, each linking to its workstream. Board shows its named no-board state. Stream: a fresh token posted in P1's composer is a `room-lines` row whose `userId` is the person; a template seat's answer is a later row with `author` set, and both are on screen after the wake. No gap copy is reachable on any tab |
| a4 | **Org-wide, members only.** The second member opens P1's Stream and reads both lines. The outsider's PROJECTS lists P1 and P2, and P1's Stream shows the members-only state with no line of the room in the page |
| a5 | **Restart.** a2 to a4 read again on a new process, the same store |
| b1 | **Hire.** The person asks CoS for a coder seat (held-out name). CoS's session holds a `hire` call with an ok result; no new `human_approval` suspension exists; TEAMS lists the seat, matching a new roster row and inventory row |
| b2 | **Fire asks.** The person asks CoS to fire it. Inbox shows a `human_approval` naming `fire`, the seat and its kind, through the existing card; roster and inventory unchanged. Restart: the seat is still listed and the ask still in Inbox |
| b3 | **Approve.** Approve in Inbox: the seat leaves TEAMS; its roster and inventory rows are gone. Restart: still gone |
| b4 | **No other seat hires.** In the feature workstream's composer, the person asks the EM seat to hire another held-out seat. No roster row appears |
| c1 | **Boot 1, `extra-kind`.** The person asks CoS for a seat S (held-out) on the scratch kind K. TEAMS lists S |
| c2 | **Boot 2, as shipped.** The boot's problems name S. The person asks CoS which seats won't start: CoS's `brokenSeats` result lists S with `kind-gone`, its answer on screen names S, and S's roster row is unchanged |
| c3 | **Retire.** The person asks CoS to retire S. Inbox shows the ask; Approve |
| c4 | **Boot 3.** The boot names no problem; TEAMS doesn't list S; neither store has its row |

## Controls

Each runs on a fresh store and must fail its leg at its own step, leaving the rest green. One that
fails at setup, reddens another leg, or is missing from the commit is a finding. Retire runs the
fire path behind the same ask ([ER-19](../../epics/FIX-1650/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)), so `deny-fire` stands for c3's Deny too.

| Control | Changes | Must fail | Stays green | Named by |
|---|---|---|---|---|
| Today's `main` | The commit before FIX-1650's first child merged | a1 · b1 · c1, no CoS seat | — | Epic goal |
| `deny-fire` | Deny instead of Approve at b3 | b3, "seat gone" | a · c | Epic goal; FIX-1719's name |
| `no-cos` | CoS's `WORKER.md` removed (S3). The Chief of Staff view shows its no-CoS state, so the person asks the EM seat as in b4. Runs b1 only | b1, "seat appears" | — | Epic goal |
| `no-tool` | `createProject` removed from CoS's `tools:` (S3) | a1, "two rows" | b · c | FIX-1718's name |

## Part 2 · the team the legs don't walk

| ID | Team | Passes when |
|---|---|---|
| J4 | **Builds the next Lab** | [D3](DECISIONS.md#d3)'s writer, seeing only the pages [DOCS.md](DOCS.md) lists and S5, adds CoS, the hire capability with `askBefore: ["fire"]`, the `projects` collection with its template and the project tools. A step no page covers is a failed step, reason *doc silent* (QR-14). Shift Manager over S5's config boots with no problem; the person asks CoS for a project and a seat; PROJECTS lists the project with a room the person can post in, and TEAMS lists the seat. `labs/shift-manager` is untouched |

The epic's other three teams are legs a, b and c.

## Part 3 · every child's check

Each child's check runs on its **green path**. A control Part 1 already failed on this commit,
with its SHA and patch in the report, stands for that child's "control must fail" and is not run
again ([closure rule](../../../docs/contributing/orchestration.md#the-closure-issue-every-epic-ends-in-qa), item 3).

| ID | Child check | Controls still run here | Covered by Part 1 |
|---|---|---|---|
| P3.1 | FIX-1621 · `goals/hire-plane/repairs-a-seat-whose-kind-was-cut/` | `fire-keeps-inventory` | — |
| P3.2 | FIX-1719 · `goals/org-seats/cos-changes-the-roster/` | — | `deny-fire` (b3) |
| P3.3 | FIX-1718 · `goals/shift-manager/it-groups-workstreams-under-their-projects/`, its `cos` leg included | `unread`, `gap-tabs`, `no-gate`, `no-retry` | `no-tool` (a1) |
| P3.4 | Every check that boots the DevTeam tree: `goals/devforce-lab/*`, the `goals/shift-manager/*` checks started with `--team devteam`, `goals/hire-plane/*`; CI green on the SHA | Their own, as each goal names | — |

## Part 4 · gap sweep

Only what parts 1 to 3 don't grade. Each *required* row is a scripted assertion in `run.mts`,
never a reading: a grep, a parse or a `git diff` from today's-`main` control to the commit.

**Required for PASS** (QR-11):

| Check | The assertion |
|---|---|
| **One remove path (ER-19)** | Across `packages/` and `apps/kitchen-sink`, exactly one site deletes a hired seat's inventory row, inside the `fire` block |
| **One orphan read (ER-5)** | The only kind-gone classifier is FIX-1621's shared check; CoS's `brokenSeats` tool resolves to its block |
| **The DevTeam tree and host** | CoS's `WORKER.md` `tools:` parses to `hire`, `fire`, `rehire`, `brokenSeats`, `createProject`, `setWorkstreams`; no team seat's `tools:` names a hire tool |
| **Gap copy (ER-8)** | No string under `labs/shift-manager/src` says something arrives with FIX-1650 or waits on org seats shipping; FIX-1651's and FIX-1652's entries are byte-identical to today's `main` |
| **Layer fence (ER-10, ER-11, ER-22)** | The diff adds no file under `packages/core` or `packages/engine` naming a Project, Workstream, CoS or admin seat; no `workforce/projects/`, `workforce/agents/` or `CHANNELS.md`; `CHANNEL.md`'s key list gains only `mintFor` |
| **Vocabulary (ER-13)** | A grep over the pages the set published finds "worker" only in paths (`org/workers/`, `WORKER.md`) |
| **Docs published (ER-18)** | Every page in the epic's [ownership table](../../epics/FIX-1650/DOCS.md#ownership) exists on the commit with its section heading |

**Observations · filed off epic** (QR-13): anything the run notices on a sibling's screen (how
TEAMS draws a dotless seat id, the CoS view's copy) or outside the epic's goal. Reported, never
gating.

## The report

The closure PR's body, and the comment a run that files findings leaves on FIX-1720:

1. **Head.** The run's number, the `main` SHA, each blocker's merge commit, the model and its
   key's provider (never the key), the store file, Chromium's version.
2. **Part 1.** Per step: PASS or FAIL, what the page showed, the store read it was compared with
   by id, and the boot's problems for each boot. Per CoS turn: the words sent, the session id,
   each tool call and result by item id. A screenshot of each leg's last step.
3. **Controls.** Each with its build or patch in full, the step it failed at and the line.
4. **J4.** The writer's files, its steps, and each *doc silent* step.
5. **Parts 3 and 4.** Each manifest entry's verdict; each required row's assertion output;
   observations.
6. **Findings.** Each with its Linear id, the step it came from, and the run that retested it;
   one the owner closed, with the reason quoted.

## Pinned names

| Where | Name |
|---|---|
| Goal check | `goals/shift-manager/one-person-runs-a-labs-projects-and-people/` |
| Steps | `a1` to `a5`, `b1` to `b4`, `c1` to `c4`, `J4`, `P3.1` to `P3.4` |
| Controls | `deny-fire`, `no-cos`, `no-tool`; scratch patch `extra-kind` |

Everything else is yours to name.

## Guardrails

| Rule | Because |
|---|---|
| No product change, and no control switch in Shift Manager or any package | The closure proves what shipped; a switch written for a test is product code |
| Every change goes through a CoS turn or an Inbox click; no hire, fire or project block is called by the check | The epic's anti-game; a route call proves the route, not the person's path |
| Every row compared by id against the store, never Shift Manager's state | A shell that draws its own rows passes a check that reads the shell |
| One graded turn per CoS step (D2) | A retry grades a CoS nobody uses |
| Part 4's required rows are executed, not read (BP-003) | A tired reader skips the row a script can't |
| Scratch patches are printed in full | A patch that changes more than it says is how a leg passes hollow |
| Every check on the one commit; today's `main` only as a control | A pass elsewhere proves nothing about the set |
| Findings are filed, never fixed here | The closure rule |

## Docs

No reader-facing change. [DOCS.md](DOCS.md) says what the run follows.

## At implement time

- Re-read the merged specs and their amendments; take the store's env name and the three users'
  secrets from FIX-1718 S12 and FIX-1719 S7 as shipped.
- FIX-1722's `it-briefs-and-talks-with-the-chief-of-staff` uses the DevTeam profile as its
  *no CoS* Lab, and FIX-1719 adds CoS to that tree. If FIX-1719 lands without moving that leg,
  P3.4 fails there: a finding against FIX-1719. Raised to the coordinator at spec time.
- **The crash promise** (a kill between Approve and the change landing leaves it whole, the fire
  still asked) is not in `run.mts`: a kill racing the resume can't fail on demand. Run it once by
  hand as a probe and report it under observations. Its deterministic test, with a fault
  injected at the resume, belongs at FIX-1719's resume path; if FIX-1719 ships none, that is a
  finding against it.
- Chromium is at `/opt/pw-browsers`; the model is `openai/gpt-5.4-mini` unless D2's flip names
  a stronger one.

## Follow-ups

None raised. D1's workstreams ship in FIX-1718's PR 3 (S11).
