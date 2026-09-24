# devforce-lab › it wakes the seat a file declared

**Issue:** FIX-1426

**Outcome:** Somebody writes a small tree of Markdown and points one call at it. A row filed by one
declared seat wakes a **different** declared seat, in its own flow instance, into a supervised
coding run — its own checkout, a verdict read before the row settles — and the prompt that run was
handed carries tokens that exist only in that seat's own files. A third seat, declared on the same
kind, is never dispatched to.

Before this, that claim had two halves that had each been proved and had never met: the pentest lab
shows a post reaching seats declared in Markdown, and `labs/conductor` shows a board row becoming a
supervised coding run — but the thing that row reaches there is hand-written TypeScript, not a seat
that came out of a folder.

**Input:** `fixtures/input.json` — the seat ids, their expected documents and skill unions, the row
the EM seat files, and where each held-out token lives. It is **held-out**: every token is read out
of the tree at run time and asserted to live in exactly one convention file and in none of the
lab's own code, so swapping the fixture for a different valid tree still passes a correct
implementation. The two names that are pinned rather than free are the kind ids (`em`, `coder`,
which the `WORKER.md` files name) and the board's `coder` assignee key.

**Signal:** seven legs, each closing named rules (`BUSINESS-RULES.md` on the spec PR):

0. every held-out token lives in exactly one convention file, in none of `lab/**/*.mts`, and in no
   part of the row the EM seat files — run **before** anything is built;
1. one root produces exactly three seats on the two kinds their files name, two documents and one
   channel; a tree naming an unregistered kind refuses the **whole** roster by name, and its
   corrected twin hires cleanly *(BR-1, BR-2)*;
2. each seat reports its own instructions, document ref and **exact** skill union from inside a
   running block, and the coordinator kind declares no task entry at all *(BR-3, BR-4)*;
3. one row, claimed once, handed to the seat the board's assignee names — graded on the **dispatch
   record**, by `flowId` — with the third seat absent from it, and a second drain claiming nothing
   *(BR-5, BR-6, BR-8, BR-9)*;
4. the prompt carries all four held-out tokens, the run's `cwd` is the checkout the framework itself
   derives for this row (and that derivation is injective over its components), and the row settles
   `completed` *(BR-10, BR-11, BR-13)*;
5. a hand-off naming an instance no seat minted errors the row `flow-not-found`, by id, and
   provisions nothing *(BR-7)*;
6. a run that finishes cleanly and leaves no commit re-pends the row with its reason attached, and
   errors it once the retry budget is spent *(BR-14)*;
7. a `boards/` folder added to the tree changes nothing the loader produces while the `channels/`
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

**Model:** n/a — model-free by design. The model-backed half is the sibling goal,
`it-commits-from-the-seats-own-file`, which drives the same tree, the same hire and the same wiring
with a real coding harness in the one slot that differs.

**Run:** `pnpm tsx goals/devforce-lab/it-wakes-the-seat-a-file-declared/run.mts`

Needs `git` and a writable temp directory. No network, no model credential, no `gh`.

## What this establishes, and what it does not

It establishes that a board row can cross flows to a seat a Markdown file declared, that the seat's
own documents and skills reach the prompt of the supervised run, and that the run works in a
checkout derived from the row. It does **not** establish anything about a real coding agent — that
is the sibling goal — and it does not establish that the extra board declaration the `coder` kind
carries is the right shape. That declaration is an interim L1 tax (D1, soft→FIX-1408), labelled as
one in the code that pays it.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-24 | e9a2fc452 | n/a | PASS | FIX-1564 review: the door probe forces trace capture for its one request, so the goal also passes under `FSDEV_TRACE_OBSERVABILITY=false` and under `NODE_ENV=production`. Without the forcing, both fail with "request.completed fired with no inline block output". A missing output now says whether `request.completed` fired. All seven legs green; the three BR-17 red states and all five controls red. |
| 2026-09-24 | ccb971b64 | n/a | PASS | FIX-1564: BR-17's positive half now goes through the same router as the refusal, carrying the lab's verified bearer on a fresh session, and is graded on the seat's own facts. Before this it was a direct `runAction` that never reached the resolver, so a door that refused everything passed. Three red states each go red: resolver refuses every bearer, bearer dropped (401), org-less probe given the bearer (answered, not refused). All seven legs green; all five controls red. |
| 2026-09-22 | c76ac5969 | n/a | PASS | Option 1 (FIX-1515): lab host wires a fail-closed verified principal. Org-less HTTP read is 401 with "verified organization"; same read with an org lands. All seven legs green; all five controls red, each on clauses traceable to its one perturbation. |
| 2026-09-17 | 4d7a5749f | n/a | PASS | All seven legs green; all five controls red, each on clauses traceable to its one perturbation. |
