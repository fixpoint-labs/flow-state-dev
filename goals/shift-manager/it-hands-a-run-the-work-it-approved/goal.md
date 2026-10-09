# shift-manager › it hands a run the work it approved

**Issue:** FIX-1717

**Outcome:** A person approves a feature in Shift Manager's Inbox, or posts `slug: what to build` on a workstream, and the coding run that starts is handed that work. Its prompt opens on the goal they approved, or the text they posted after `slug:`, word for word. It also carries the coder seat's own files, the workstream's charter when the coder is a member of it, and where and how to work. It carries nothing private to another seat and nothing said on the mailbox. A real coding run does the approved work.

**Input:** `fixtures/input.json`, held out. Three features (one approved, one posted, one for the real run), one line posted on the mailbox that files nothing, and the tokens graded in the prompt, each with the one tree file it lives in. The approved and posted goals, the posted line and the real run's token and file name are spelled in no lab code and no tree file (leg 0 checks this before anything is built). Another valid feature in any of the three slots must pass a correct implementation. The real run's goal names one file and one token, so its commit is gradable without judging the model's code.

**Signal:** the DevTeam tree, opened through `openLab` as the `devteam` profile opens it: the EM seat's ask raised at boot, the feature mailbox's door on, the inventory on. Approval goes through the engine's resume route with the lab's verified bearer, as Inbox sends it. Failures are tagged by leg.

- **0** (held-out): the fixture's goals, posted line, token and file name live in no lab code or tree file. Every graded token lives only in the file the fixture names for it.
- **a1** (BR-1, BR-3, BR-5, BR-6, BR-7, BR-8): a line is posted on the mailbox, then the pending ask is approved. The stub's recorded prompt carries the approved goal, and carries it before any of the coder seat's own tokens. It carries the charter's token and all four coder tokens. Its terms paragraph (the one naming the run's checkout) names the run's branch and no acceptance check. It carries none of the coordinator seat's tokens and not the posted line.
- **a2** (BR-1): a second feature, filed by a `slug: goal` post. Its run's prompt carries the posted goal, before the seat's tokens, and not the approved one.
- **a3** (BR-4): a tree copy with the coder removed from the mailbox's `members`. The run's prompt carries the approved goal and no charter.
- **a4** (BR-6): opened with acceptance required. The run's terms paragraph names the acceptance check.
- **b** (BR-1, BR-13): Claude Code through its Agent SDK in the harness slot, approved the same way. A commit on the run's branch carries the token the approved goal names.

`GOAL_LEG=a` runs leg 0 and the a legs. `GOAL_LEG=b` runs leg 0 and leg b. Unset runs all of them.

**Anti-game:** a hollow pass is a prompt that looks right in a stub while no run is handed the approved work, or a check that grades what it fed in. So the check never asserts on the row, on `lab.file`, or on a builder it calls itself. Leg a grades only the prompt the harness slot received. Leg b grades only the commit the real run left. The approval goes through the same route and bearer Shift Manager uses, and the posted feature through the mailbox's own door. Leg b grades the token in the commit, not the code the model wrote, and has no stub fallback.

**Model:** real — Claude Code's own, through the Agent SDK, for leg b only. Leg a and leg 0 are model-free (`GOAL_LEG=a` needs no credential).

**Run:** `pnpm tsx goals/shift-manager/it-hands-a-run-the-work-it-approved/run.mts`

Needs `git` and a writable temp directory. Leg b also needs a signed-in Claude Code Agent SDK or an Anthropic key.

**Controls:** `GOAL_CONTROL=list` prints them.

- `GOAL_CONTROL=drop-task`: the lab's prompt builder ignores the task the manager hands it. Leg a must FAIL on **a1, a2, a3: the prompt does not carry the approved (posted) goal**. Leg b must FAIL on **b: the commit does not carry the goal's token**.

The rest of leg a's assertions have no named control. Their red states were produced by mutating the lab once each, and are recorded in the verdict log.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-01 | 4c7a6571f (main, before the change) | n/a | FAIL (expected) | `GOAL_LEG=a`: a1, a2, a3 "the prompt does not carry the approved (posted) goal"; a1 "does not carry the shared mailbox's charter"; a4 "the run's terms do not say the acceptance check decides". What the issue reported: the run is handed the seat's brief, not the approved task. |
| 2026-10-01 | 4c7a6571f+wip (FIX-1717) | Claude Code (Agent SDK) | PASS | All legs. Leg b's commit on `…/release-note-file--implement` carried the approved goal's token. |
| 2026-10-01 | 4c7a6571f+wip (FIX-1717) | Claude Code (Agent SDK) | FAIL (control `drop-task`, expected) | Exactly a1, a2, a3 "the prompt does not carry the approved (posted) goal" and b "the commit does not carry the goal's token". Nothing else went red. |
| 2026-10-01 | 4c7a6571f+wip (FIX-1717) | n/a | FAIL (mutations, expected) | One lab mutation at a time, `GOAL_LEG=a`, each reddening only its own assertion: task placed after the seat's files → "does not open on the goal" (a1, a2, a3); coder instructions dropped → "lost CODER-INSTRUCTIONS-B42D9"; EM's `WORKER.md` appended → "carries the coordinator seat's EM-INSTRUCTIONS-A17C3"; branch left out of the terms → "terms do not name its branch"; acceptance text always on → "without acceptance required, the terms still name an acceptance check"; membership test removed → a3 "a seat that is not a member was handed the charter"; first task's goal cached into later prompts → a2 "carries the other task's goal"; an unfiled mailbox line put on the next row's context → a1 "carries a line posted on the mailbox". |
| 2026-10-08 | fix/closure-children-one-copy (main 0f569d032) | Claude Code (Agent SDK) | PASS | Approve resumes through the flow the EM's session is on (`em`), not `eng.em` (FIX-1788 P4). Before, every approve answered 404. All legs. `drop-task` FAILs at exactly a1, a2, a3 and b. |
