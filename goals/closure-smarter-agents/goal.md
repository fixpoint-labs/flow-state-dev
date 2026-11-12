# closure-smarter-agents › workers in all four apps answer with evidence

**Issue:** FIX-2541 (closure of epic FIX-2490). Spec: `specs/issues/FIX-2541/`.

**Outcome:** A user of each of the four apps (the Claude Code-style lab, the Teammates lab, Kitchen
Sink, Shift Manager) gets today's date, a multi-file answer in one turn, a coder's report whose
checks really ran, a cited knowledge answer, a short answer to a short question, a skill used
without a slash, and (in the two labs) a decision kept across a summary fold, with nothing the app
wrote itself.

**Input:** drawn new each run (`fixtures.mts`), **held out**: three `LC-<6>-<3>` values planted in
separate files of the project or working folder; three handbook files whose timeouts differ; the
skill's marker (`RN-<4>`), written into the asked worker's `skills/` for the run; the decision and
the option it replaced; the one-line sum; the coder's failing `node check.mjs` and its exit code.
Kitchen Sink's multi-file ask can't plant a value in published docs, so it draws a question from
a pool whose answer needs facts from three separate pages of flow-state.dev; its knowledge ask
draws a docs question.

**Who is asked** (`<app>/run.mts`):

| Ask | Claude Code-style | Teammates | Kitchen Sink | Shift Manager |
|---|---|---|---|---|
| date, sizing, skill | `desk.main` | `teammates.chief-of-staff` | `support.help` (routes to a specialist) | `shift-coordinator` |
| multi-file | `desk.main`, set to the project | `teammates.researcher`, over the working folder | `support.fsd`, over the docs | `researcher`, set to the project |
| knowledge | `desk.researcher` | `teammates.researcher` | `support.fsd` | `researcher` |
| coder | `desk.main` (hands it to a coding run) | `teammates.chief-of-staff` (hands it to Claude Code) | a `claude-code-session` | `eng.em` (files it for the coder) |
| fold | `desk.main`, at the wrap only | `teammates.chief-of-staff` | — | — |

**Signal** (`asks.mts`), per ask, per run:

- **date** a date the reply names is today by the run's own clock (read at ask and reply), and no other.
- **multi-file** one request, and every planted value is in the reply. Kitchen Sink: every page
  the drawn question needs is the `url` of a successful call of its page-fetch tool in that turn (a
  search that names the page reads nothing), and the reply states each fact.
- **coder** graded from the record outward: each recorded check the report names must have the
  outcome the report gives it (the workspace's own pass rule), and at least one must be named. Only
  a code span can name a check the record lacks, which fails; prose is never parsed into a command.
  A `null` record fails. The record is the run
  record's `checks` (labs, Shift Manager), or the harness session turn's (Kitchen Sink).
- **knowledge** at least 3 lookups, and a cited source is one a lookup returned.
- **sizing** the sum, in 50 words or fewer (D2).
- **skill** precondition: the worker holds the skill; then no slash in the ask, a `loadSkill` of
  it in the turn, and the marker in the reply.
- **fold** precondition: the session's `historySummary` counts a fold and its latest request
  carries a `historyStart` (`goals/lib/history.mts`, as `history-window` reads it); then the reply
  names the decision and not the option it replaced.

An ask passes in an app on 3 of 3; on a pass it passes only in every app where it runs (D1). The
fold counts on Teammates alone on the control and the cut run, and in both labs at the wrap.

**Anti-game:** nothing asserts on a layer's prompt text. The date is never seeded. A cited source
must be one a lookup returned; a check the report names must be in the record; a page must have
been fetched. The fold and skill asks fail, not pass, when their mechanism did not fire. The
driver answers what an app stops to ask the person (a tool approval: yes; a review of a run's
changes: accepted), as the person at the page would; a question a run asks is left waiting.

**Switches:** on the control and the cut run, the scripts write `skills: activateTool: true` into
the asked worker's `WORKER.md` for the run (Kitchen Sink: each specialist the desk routes to), and
set Teammates' `TEAMMATES_CHECKS`. At the wrap they set nothing. The fitting skill is a fixture
(its marker is held out) and is planted on every pass. Everything planted is journaled and put
back after the run, and by the next run if the machine killed this one (`closure.mts` →
`planted`). A project's checks (the labs' and Shift Manager's project row, Kitchen Sink's
`KITCHEN_SINK_HARNESS_CHECKS`) are the project's data, a fixture on every pass.

**Sweep** (`verdict/run.mts`): no app's `WORKER.md` carries date or "done" guidance of its own
(epic ER-3). Reported on every pass; a failure at the wrap.

**Model:** real. By default each app's own (through the AI Gateway), coder asks on Claude Code's
own sign-in and model. With `GOAL_HAIKU=1`, every app's agents run on Haiku on Anthropic directly
(`model.mts`): each app is served through `haiku.config.mts`, which loads the app's own config and
answers every model it names, generators and evaluators, with `anthropic/claude-haiku-5-5`, keyed by
`MY_ANTHROPIC_API_KEY`; the served process gets no gateway key, and Claude Code gets the same key and
runs Haiku (the project's `.claude/settings.json`; Kitchen Sink's session model). Each sheet result is
stamped with its models (`app` or the Haiku id) beside its commit, and the verdict refuses a pass whose
sheets mix them.

**Run** (one pass = all four, then the verdict):

```bash
pnpm tsx goals/closure-smarter-agents/graders/run.mts         # graders and rules, model-free
GOAL_PASS=control pnpm tsx goals/closure-smarter-agents/<app>/run.mts   # serves 0df5c85's tree
GOAL_PASS=cut     pnpm tsx goals/closure-smarter-agents/<app>/run.mts   # this checkout
GOAL_PASS=wrap    pnpm tsx goals/closure-smarter-agents/<app>/run.mts   # sets nothing
GOAL_PASS=<pass>  pnpm tsx goals/closure-smarter-agents/verdict/run.mts

# On Haiku: the same commands with GOAL_HAIKU=1 (every app script of a pass, so its sheets agree)
GOAL_HAIKU=1 GOAL_PASS=cut pnpm tsx goals/closure-smarter-agents/<app>/run.mts
```

`GOAL_ASKS=date,sizing` runs a subset (the sheet keeps the other asks only when they ran on the same commit; the verdict refuses sheets from another commit, or a mix), `GOAL_RUNS` the number of
runs, `GOAL_COMMIT` another tree, `GOAL_SHEETS` where sheets are kept, `GOAL_FOLD_TURNS_MAX` the
most filler turns before the fold question (default 200). The fold ask sends fillers until the
session's record shows its earliest turns out of the window the server applies, then three more;
it reads that window off the record, never assumes one.

**Needs:** `AI_GATEWAY_API_KEY` and a Claude Code sign-in; or, with `GOAL_HAIKU=1`,
`MY_ANTHROPIC_API_KEY` alone (the Anthropic key, for the agents and Claude Code both). Either way, a
non-root host for Kitchen Sink (its Claude Code mode is off as root); Kitchen Sink's multi-file and
knowledge asks need its specialist's search and fetch tools (FIX-2496).

**Controls:** the control pass itself (`GOAL_PASS=control`): each ask must fail at least one run
in at least one app where it runs.

## Verdict log
| Date | Commit | Pass | Verdict | Notes |
|------|--------|------|---------|-------|
