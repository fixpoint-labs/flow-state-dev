# FIX-2541 · Decisions

[Spec](SPEC.md) · **Decisions**

The epic decided what the closure proves (seven asks, 3 of 3, a control that fails, the cut
run). It left three things to this issue, which owns how its scripts assert (epic
[ER-7](../../epics/FIX-2490/DECISIONS.md#who-owns-what)): how far one passing app reaches,
what "short" means, and what to do where a mechanism is missing.

<a name="d1"></a>
## D1 · A layer is cut only when its ask passes 3 of 3 in every app where it runs

| | |
|---|---|
| **Instead of** | Cutting a layer when its ask passes in any one app, or in most of them |
| **Because** | The four apps reach their workers four different ways (a desk main session, a Chief of Staff, a support desk, a coordinator). A bug fix that dates Kitchen Sink's chat leaves the other three undated, which is why the epic keeps the environment section regardless. A pass in one app says nothing about the others. The same bar at the wrap means one rule, not two (tenet 3) |
| **Locks in** | ER-6's "passes 3 of 3" reads as "in every app where the ask runs": four apps, two for the fold. A cut cites the four cells. More layers survive the cut run than under any-app |

**What would change my mind:** the apps sharing one worker path, so one app's pass speaks for
all. Today they do not.

![D1, when the cut run cancels a layer. Chosen: only when its ask passes 3 of 3 in every app where it runs. Instead of: when it passes in any one app. It comes down to a layer that helps one app; under any-app it is cancelled while that app stays broken. Price: more layers built. Same bar at the wrap. Flips if the apps shared one worker path](figures/d1-cut-everywhere.svg)

<a name="d2"></a>
## D2 · A short answer is the right fact in 50 words or fewer, counted, not judged

| | |
|---|---|
| **Instead of** | A model judge rating whether the answer is sized to the question |
| **Because** | A word count plus a held-out fact cannot be gamed: an empty "it depends" fails on the fact, an essay fails on the count. A judge drifts between runs and needs its own control, which is the eval apparatus the epic's D2 rejected. 50 words is about three sentences; the one-line question's answer is one |
| **Locks in** | The sizing ask's threshold, in its `goal.md`. FIX-2498's behaviour section is cut or proven against it |

**What would change my mind:** short replies reading as curt to users in the apps. Then the bar
is a judge, and the epic's no-apparatus rule is reopened on purpose.

![D2, what counts as a short answer. Chosen: the right answer in 50 words or fewer, by count. Instead of: a model judge rating it well sized. It comes down to gaming; a count plus a held-out fact can't be passed by an empty short reply, while a judge drifts. Price: padding under 50 words passes. Flips if short replies read as curt to users](figures/d2-short-answer.svg)

<a name="open"></a>
## Open · The Claude Code-style lab has no summary fold to switch on

**The fork.** The epic says the control and the cut run switch on "today's `historySummary`
fold in both labs". Teammates has one (it folds today). The Claude Code-style lab has none: no
fold, no switch. So in that lab the fold ask fails its precondition on the control and the cut
run, by construction, and under D1 FIX-2500 could never be cut.

**Plain terms.** Whether the summary layer can be cancelled by the cut run at all, and on what
evidence.

**The trade-off.** Reading the cut on Teammates alone keeps the scripts honest (they patch no
app) but decides the summary on one lab. Patching a fold into the Claude Code-style lab for the
run tests both labs, but tests a fold that lab never shipped.

**Recommendation.** Decide FIX-2500's cut on Teammates alone; the Claude Code-style lab runs
the fold ask at the wrap only, where FIX-2500's default must carry it. It is the only option
that measures something real in both places.

**What would change my mind.** The two labs being meant to fold differently. Then each needs
its own cut, and the lab needs a fold before the cut run means anything there.

**If wrong.** At worst the summary is cut on one lab's evidence and the wrap's run in the other
lab fails. That re-opens FIX-2500 late, at wrap, by one issue.

![Open question: the Claude Code-style lab has no summary fold to switch on. Recommended: decide the summary's cut on Teammates alone, and run the lab at the wrap. Or: add today's fold to the lab for the run, which patches an app with a fold it never shipped. The wrap is the same either way. Flips if the two labs fold differently by design](figures/open-fold-in-the-lab.svg)

<a name="decided-not-asked"></a>
## Decided, not asked

- **The real path is each app served as it is, and driven over its public API.** The epic
  says `fsdev run`. Every existing goal for these four apps serves the app with `fsdev dev`
  (or Shift Manager's command) and talks to it through the client, because a worker's turn
  spans sessions and a coding run that one `fsdev run` process does not host. Same real path,
  same model, no mock.
- **The control is pinned to `0df5c85`**, main when the epic merged, before any bug fix. "Today's
  `main`" moved as the bugs merged; a control on a moving commit can pass for the wrong reason.
  The scripts run against a worktree of that commit.
- **The date is read from the wall clock at ask and reply.** A turn that straddles midnight may
  name either day; a seeded date never counts (epic implementer note).
- **Kitchen Sink's coder leg reads the turn's `verify` record**, not a run record: its harness
  session records checks on the turn. The grader is the same.
- **The scripts live in `goals/closure-smarter-agents/`** at implementation, one `run.mts` per
  app and one shared module of legs. The POC's graders move there unchanged in shape.
- **Fixtures are new each run**: planted values, the skill's marker, the decision's words.
- **The coder leg runs Claude Code** in all four apps, the harness each app has by default;
  Codex and Cursor are not part of the closure.

## Decided in build

- **Kitchen Sink's multi-file ask reads published docs, drawn from a pool (EM, Nov 4).** No fresh
  value can be planted in published pages, and Kitchen Sink gets no local-docs tool for the
  closure. So it stays in all four apps, with two guard rails: each run draws one question from a
  pool whose answer needs facts from three separate flow-state.dev pages, and the run passes only
  if the turn's own tool calls fetched every one of those pages and the reply states each fact. A
  fact the model already knew fails on the fetch. The pool is `fixtures.mts` → `DOC_ASKS`; each
  page and fact was checked against the published site.
- **Switches and the fitting skill are written at run time, never committed.** On the control and
  the cut run the scripts add `skills: activateTool: true` to the asked worker's `WORKER.md` for
  the run, and put it back after; the wrap writes no switch. The skill itself is a held-out fixture
  (a new marker each run), planted on every pass. What a run plants is journaled first, so a run
  the machine kills is undone by the next one.
- **The driver answers what an app stops to ask the person.** A tool approval gets "yes" for the
  run, a review of a run's changes gets "accepted", as the person at the page would to let the
  work they asked for go on. A question a run asks is left waiting.

## Considered and dropped

- **One monolith per app with seven inline asserts.** Four copies of each grader that drift.
  The implementer note on the issue asks for shared legs; D1 needs one sheet across apps.
- **A judge for knowledge and sizing.** Rejected in D2 and by the epic's D2.
- **Running the control on each bug's parent commit.** Six controls instead of one, and the
  per-ask control already shows each ask can fail.

## Settled

- **The graders refuse hollow turns (POC, Nov 4).** `poc/closure-asks/check.mts`: 25 planted
  turns, 17 hollow (a stale date, a check that never ran, a source never looked up, a short
  empty reply, a skill not held, no fold), each refused; 8 sheet rules read as D1 says. Planting
  two broken graders (no word count, no fold precondition) turned it red on exactly those two
  cases. The premise held: the asks can be graded on what the worker answers.
- **The Claude Code-style lab has no fold (read, Nov 4).** No `historySummary` anywhere under
  `labs/claude-code-style`; Teammates builds one in `host.mts`. This is the open question.

- **The four app drivers are built (Nov 4).** `goals/closure-smarter-agents/<app>/run.mts`, one
  per app, over the shared graders and `closure.mts`; `verdict/run.mts` reads a pass's sheets. One
  real-model run of each non-coder ask reached every app's worker. The coder ask has not yet
  passed on a host where Claude Code starts, and Kitchen Sink's docs asks wait on FIX-2496. The
  POC in `poc/closure-asks/` stays as the retained evidence the graders came from.

## How it got here

- **Draft (Nov 4)** — the closure framed as one shared set of seven graders over four app
  drivers, built on the existing goals for each app; D1 and D2 pin what the epic left to
  ER-7's owner; the missing fold in the Claude Code-style lab raised as the one open question.
