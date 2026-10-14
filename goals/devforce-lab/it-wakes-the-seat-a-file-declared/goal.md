# devforce-lab › it wakes the seat a file declared

**Issue:** FIX-1426

**Outcome:** Somebody writes a small tree of Markdown and points one call at it. A row filed by one
declared seat wakes a **different** declared seat, in its own flow instance, into a supervised
coding run — its own checkout, a verdict read before the row settles — and the prompt that run was
handed carries tokens that exist only in that seat's own files. A third seat, declared on the same
kind, is never dispatched to.

Before this, that claim had two halves that had each been proved and had never met: the pentest lab
shows a post reaching workers declared in Markdown, and `@flow-state-dev/harness-manager` shows a
board row becoming a supervised coding run — but the thing that row reaches there is hand-written
TypeScript, not a worker that came out of a folder.

**Input:** `fixtures/input.json` — the seat ids, their expected documents and skill unions, the row
the EM seat files, and where each held-out token lives. It is **held-out**: every token is read out
of the tree at run time and asserted to live in exactly one convention file and in none of the
lab's own code, so swapping the fixture for a different valid tree still passes a correct
implementation. The two names that are pinned rather than free are the kind ids (`em`, `coder`,
which the `WORKER.md` files name) and the board's `coder` assignee key.

**Signal:** seven legs, each closing named rules (`BUSINESS-RULES.md` on the spec PR):

0. every held-out token lives in exactly one convention file, in none of `packages/shift-manager/teams/devteam/**/*.mts`, and in no
   part of the row the EM seat files — run **before** anything is built;
1. one root produces exactly three team seats on the two kinds their files name, plus the org's
   shift coordinator and project coordinator on `coordinator`, its general lead and researcher on `agent`,
   the eng team's coordinator worker (`eng.triage`) on `coordinator`, two documents
   and no mailbox (the feature and release work are workstreams the EM leads); a tree naming an
   unregistered kind refuses the **whole** roster by name, and its corrected twin hires cleanly
   *(BR-1, BR-2)*;
2. each seat reports its own instructions, document ref and **exact** skill union from inside a
   running block, and the coordinator kind declares only its delegated-post task entry, which runs
   the EM's own turn and dispatches rather than running a harness; its file imports no harness
   package *(BR-3, BR-4)*;
3. one row, under the id the EM session's board minted and naming its issue and phase in its
   payload, claimed once, handed to the seat the board's assignee names — graded on the **dispatch
   record**, by the `workerId` each child session names — with the third seat absent from it, and a second drain claiming nothing
   *(BR-5, BR-6, BR-8, BR-9)*;
4. the prompt carries all four held-out tokens, the run's `cwd` is the checkout the framework itself
   derives for this row on the board it sits on (and that derivation is injective over its
   components), and the row settles `completed` *(BR-10, BR-11, BR-13)*;
5. a hand-off naming an instance no seat minted errors the row by that id (it is not one the EM's
   session hands to), and provisions nothing *(BR-7)*;
6. a run that finishes cleanly and leaves no commit is retried with its reason in the next
   prompt, and the row errors once the retry budget is spent *(BR-14)*;
7. a `boards/` folder added to the tree changes nothing the loader produces while the `workers/`
   folder beside it loads, and an org-less read is refused at the transport door while the same read
   through the same door, carrying the lab's verified bearer, lands with the seat's own facts
   *(BR-16, BR-17)*.

**Anti-game:** a hollow pass here looks like a seat that read none of its own files while a model
improvised a plausible commit — which is why this half runs **with no model at all** and grades what
the plumbing carried. Three rules follow from that, and the check obeys all three:

- **No token is graded in what the run produced.** Only the prompt the manager built is evidence
  that a file was read. What a model wrote is not.
- **Nothing is read off `hireWorkforce`'s return value.** Every seat fact comes off the seat's own
  config bag or through the resource surface inside a running block; reading the mint's output would
  only prove the mint agrees with itself.
- **Every rule is exercised on the hand-off.** A check that reached the seat by calling it directly
  would prove the seat works and say nothing about the claim.

Skill unions are graded by **set equality**, never presence and never sibling-exclusion: the three
seats share a team folder by design, so exclusion fails a correct run and presence passes a seat
handed every skill in the tree.

**Controls** — `GOAL_CONTROL=list` prints them; each must go red, and each names what it perturbed:

| Control | Perturbs | Goes red on |
|---|---|---|
| `address-the-reviewer` | the board's assignee address | the dispatch record names the seat that must never be reached |
| `no-commit` | what the run leaves behind | the row does not settle done |
| `swap-documents` | the working seat's `document:` | its own brief's token cannot reach the prompt |
| `drop-own-skill` | the working seat's resolved skill union | set equality, and the skill's token in the prompt |
| `stopped-at-limit` | the stop report the run makes | the row does not settle done |

The lab runs with no judge: a row on a session's board is judged before it closes, and the stub
answers nothing a judge could pass. The judge is `it-answers-a-conversations-task`'s to grade.

**Model:** n/a — model-free by design. The model-backed half is the sibling goal,
`it-commits-from-the-seats-own-file`, which drives the same tree, the same hire and the same wiring
with a real coding harness in the one slot that differs.

**Run:** `pnpm tsx goals/devforce-lab/it-wakes-the-seat-a-file-declared/run.mts`

Needs `git` and a writable temp directory. No network, no model credential, no `gh`.

## What this establishes, and what it does not

It establishes that a board row can cross flows to a seat a Markdown file declared, that the seat's
own documents and skills reach the prompt of the supervised run, and that the run works in a
checkout derived from the row. It does **not** establish anything about a real coding agent — that
is the sibling goal.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-24 | 6c723a06c | n/a | PASS | FIX-1564 rework: the bearer probe reads the seat's facts from a stream-only `component` item the inspect entry emits, not from a trace item. Passes under the default env, under `FSDEV_TRACE_OBSERVABILITY=false`, and under `NODE_ENV=production`, with nothing forced. With the emission removed it fails under both the default and trace-off envs, even though the trace update is still on the wire. All seven legs green; the three BR-17 red states and all five controls red. |
| 2026-09-24 | e9a2fc452 | n/a | PASS | FIX-1564 review: the door probe forces trace capture for its one request, so the goal also passes under `FSDEV_TRACE_OBSERVABILITY=false` and under `NODE_ENV=production`. Without the forcing, both fail with "request.completed fired with no inline block output". A missing output now says whether `request.completed` fired. All seven legs green; the three BR-17 red states and all five controls red. |
| 2026-09-24 | ccb971b64 | n/a | PASS | FIX-1564: BR-17's positive half now goes through the same router as the refusal, carrying the lab's verified bearer on a fresh session, and is graded on the seat's own facts. Before this it was a direct `runAction` that never reached the resolver, so a door that refused everything passed. Three red states each go red: resolver refuses every bearer, bearer dropped (401), org-less probe given the bearer (answered, not refused). All seven legs green; all five controls red. |
| 2026-09-22 | c76ac5969 | n/a | PASS | Option 1 (FIX-1515): lab host wires a fail-closed verified principal. Org-less HTTP read is 401 with "verified organization"; same read with an org lands. All seven legs green; all five controls red, each on clauses traceable to its one perturbation. |
| 2026-09-17 | 4d7a5749f | n/a | PASS | All seven legs green; all five controls red, each on clauses traceable to its one perturbation. |
| 2026-09-30 | a1b122eb1 | n/a | PASS | Rows now on the feature mailbox's board. All five controls fail at their named legs. |
| 2026-10-01 | a25134ebd+wip (FIX-1691/1692) | n/a | PASS | After the stub took optional narrated steps (unused here). All five controls FAIL. |
| 2026-10-08 | `865abc573` + FIX-1788 P4 | n/a | FAIL (control) | `address-the-reviewer`: the drain dispatched to ["eng.reviewer"] and the coder's tokens missing. `no-commit` and `stopped-at-limit`: the row settled pending. `swap-documents`: eng.coder reads engineering-handbook. `drop-own-skill`: eng.coder holds only commit-style. |
| 2026-10-08 | `865abc573` + FIX-1788 P4 | n/a | PASS | The lab on one copy per worker flow (`em`, `coder`, `agent`): the EM's board handed the row to a session on `coder` naming `eng.coder`, graded on the dispatch record's `workerId`; the reviewer on the same flow never reached; each seat's own files in its prompt. A tree naming `codr` registered nothing. |
| 2026-10-09 | fix/closure-children-one-copy (main 57d2c10e9) | n/a | PASS | The fixture's chief of staff is on `coordinator`, the flow its `WORKER.md` names since FIX-1791 P1. Before, it failed on "chief-of-staff was hired into kind `coordinator`, not `agent`". All five controls FAIL at their named legs. |
| 2026-10-10 | 2a5e9b1b+uncommitted (FIX-1792 P3) | n/a | PASS | DevTeam's `eng.triage` and `ops.oncall` are `WORKER.md`s on `coordinator` (delegates [eng.em], routing everyone), no longer mailboxes. Before the fixture change the converted tree failed (a) on hired [... eng.triage, ops.oncall, project-coordinator, workstream-coordinator] and mailboxes [eng.feature, ops.release]; the two org coordinators were already missing from the fixture since FIX-1793 P3, so the fixture now lists them too. 8 seats, 2 mailboxes. All five controls FAIL at their named legs: `address-the-reviewer` dispatched to [eng.reviewer], coder tokens missing; `no-commit` and `stopped-at-limit` settled pending; `swap-documents` eng.coder reads engineering-handbook; `drop-own-skill` eng.coder holds only commit-style. |
| 2026-10-11 | `cfafdf52`+wip (DevTeam off mailboxes) | n/a | FAIL (control) | All five FAIL at their named legs: `address-the-reviewer` dispatched to ["eng.reviewer"], coder tokens missing; `no-commit` and `stopped-at-limit` settled "errored" ("the implement phase is still not done"); `swap-documents` eng.coder reads engineering-handbook, the brief's token missing; `drop-own-skill` eng.coder holds only commit-style, BRANCH-NAMING missing. |
| 2026-10-11 | `cfafdf52`+wip (DevTeam off mailboxes) | n/a | PASS | Converted: the DevTeam declares no mailbox, and the EM files on its own session's board, under a minted id with `{issue, phase}` in the payload (the `FEATURE-CHARTER` token went with the feature `MAILBOX.md`). The checkout is derived from the row's id on that board (`runBoardSegment("tasks", partition)`). A hand-off to an unminted id is refused as not one of the session's delegates, by id. A session's board retries a not-done row at once, so leg f grades the retry's prompt and the spent budget, not a pending moment; `no-commit` and `stopped-at-limit` now settle `errored`, not `pending`. The lab runs `withoutJudge`. |
| 2026-10-11 | `7af86476` (DevTeam off mailboxes, merged with FIX-1866 P3 `f4978593`) | n/a | PASS | Re-run on the merged tree: 8 seats on 2 kinds, no mailbox; the row handed to eng.coder by id; a hand-off naming no delegate errors the row by name. |
| 2026-10-11 | FIX-1792 P4 on 617aeabb + uncommitted | n/a | PASS | Converted: leg a's "no mailbox" reads the tree's files for a `MAILBOX.md` (the loader has no mailbox list any more), and leg g's loader comparison is over workers and documents. 8 workers on 2 kinds, 2 documents, no mailbox file; the row handed to eng.coder on the dispatch record, eng.reviewer never reached; all 4 held-out tokens in the prompt; the row settled completed; the unminted hand-off errored by name; the no-commit retry and spent budget; the boards/ folder loads as nothing, and the org-less read is refused while the bearer read lands. No control targets the two changed legs, so none was re-run. |
| 2026-10-11 | FIX-1883 (FIX-1793 P5) on 9a618969 + uncommitted | n/a | PASS | The fixture drops the removed `workstream-coordinator` org worker: 7 on 2 kinds, no mailbox |
| 2026-10-13 | main `7c9cc1bb` + FIX-1966 | n/a | PASS | Before: FAIL on main, on the hired list (the org's `general-lead` and `researcher` from FIX-1920 were missing) and on "eng.em declares task entries [onDelegatedPost]". FIX-1872 D1 gives the EM a delegated-post task entry that runs its own turn, so leg b now wants exactly that one task entry, and refuses any harness package import in `em.mts`. Both red states checked by hand (no `GOAL_CONTROL` replays them): a `work` entry beside the post entry fails, and an `@flow-state-dev/harness-manager` import fails. All five controls FAIL at their named legs. |
