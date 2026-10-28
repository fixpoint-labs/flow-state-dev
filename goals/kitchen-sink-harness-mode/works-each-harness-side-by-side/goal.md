# kitchen-sink-harness-mode › it works each harness side by side

**Issue:** FIX-1918 (the closure of epic FIX-1907; [spec](../../../specs/issues/FIX-1918/SPEC.md))

**Outcome:** A person picks each of Kitchen Sink's four modes (Flow State, Claude Code, Codex, Cursor) in one Kitchen Sink, on each harness's real model, and works a session in each as they would use that harness directly. Each turn continues that mode's own conversation, the run shows while it works, the harness's own plan stays beside it across a reload, and nothing of one mode shows in another.

**Input:** a fresh token per mode per run, and three step names per harness per run, which no other mode or run uses. Any other token or names must pass. A durable store (`STORE_TYPE=filesystem`), shared by all four modes. `KITCHEN_SINK_HARNESS_WORKSPACE` unset on a development server. `fixtures/input.json` names the port, the modes, what each harness calls its plan, and `codexPlan`: `"none"` while Codex's CLI offers its model no plan tool, `"rows"` once Codex's plan lands ([FIX-1918 DECISIONS → Open](../../../specs/issues/FIX-1918/DECISIONS.md#open-codexs-plan)).

**Signal:** one real browser against `next dev`, one tab per mode, on a host where Claude Code, Codex and Cursor are signed in and can start their sandboxes, and Flow State's gateway key is set. The modes run interleaved (turn 1 in each, then turn 2 in each, then the job in each harness, then a reload and turn 3 in each), so each binding is read back after the other modes' turns wrote to the same store. Each assertion is `<mode>:<leg>`, mode `fs`, `cc`, `cx` or `cu`.

- **host**: the picker shows the mode available. A mode that isn't fails here with the picker's reason and is not walked; the others still are.
- **l**: one of the run's items (an answer, a tool line or a tool group) shows before turn 1 completes.
- **c**: turn 2 asks for the token without naming it; the reply names it, and the conversation is turn 1's: the id the page shows as bound for a harness, and for Flow State the session the page sends its turns to.
- **p**: the job asks the harness to plan three steps with this run's names and complete them. `cc` and `cu`: the panel's rows are those names, in order. `cx`: with `codexPlan: "none"`, the panel says "Codex reports no plan." and holds no row; with `"rows"`, as `cc`. `fs`: not graded, since its flows' plans are their own (ER-8).
- **r**: after a reload the page is back in the same session without a click, with the same id, and turn 3 names the token in it.
- **kept**: after the reload and turn 3, which leaves the plan alone, the panel still holds **p**'s rows (or still says Codex reports none): the plan is the conversation's, not the turn's (FIX-2259).
- **own**: the mode's rail lists none of the other modes' sessions, and its plan panel holds none of their step names.

**Anti-game:** the token count, the rows and the ids are read off the page; Flow State's session off the requests the page itself sends. Never a child's helper, never the scripted model in the plain run, and never a prompt Kitchen Sink built: each prompt is the person's alone, and turns 2 and 3 never name the token. **p** compares rows to names picked at run time, so a plan left by another run can't pass it.

**Model:** each harness's own default model, as its mode runs it, and Flow State's default (`vercel:anthropic/claude-sonnet-5.5`, through the AI Gateway). The check needs models that follow "answer with the token only" and use their plan when asked to.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-harness-mode/works-each-harness-side-by-side/run.mts`

**Controls:** on the same command. The plain run serves Kitchen Sink outside test mode, so every model is real. `no-resume` and `no-record` are read by the server only in test mode (`lib/goal-control.ts`), where Flow State's model is scripted, so those two walk the three coding modes only and say so in the evidence.

- `GOAL_CONTROL=no-resume`: the session hands each harness no conversation to continue. Must FAIL at **c** and **r** for `cc`, `cx` and `cu`. **kept** may follow, since each turn then starts a new conversation with no plan.
- `GOAL_CONTROL=no-record`: the Claude Code and Cursor blocks declare no plan record. Must FAIL at `cc:p` and `cu:p`. **kept** may follow.
- `GOAL_CONTROL=new-conversation`: the page's turn 2 in Flow State goes to a fresh session of its flow, at the page's `fetch` (Playwright routing; Kitchen Sink carries no switch). Must FAIL at `fs:c`. `fs:r` may follow, since the reload opens the newest session.
- **The commit before FIX-1914** (`git checkout ff0a871817^`, by hand): there is no picker, so every leg fails at entry.

A control that leaves a must-leg green, or reddens a leg it doesn't name, fails the run.

**Dry run:** `GOAL_SCRIPTED=1` on the same command serves the scripted harnesses and model (test mode without `KITCHEN_SINK_REAL_HARNESS`), so the walk's own mechanics (the picker, each tab's session, the bound ids, the reload, the panel, **own**) can be exercised on any host. The scripted harnesses don't recall a token or plan on a free prompt, so **c**, **r** and **p** fail there by design. It always FAILs with a `[scripted]` line: it is never a verdict.

**Host:** a signed-in, non-root host. In a container that runs as root, Claude Code mode is unavailable, and the other harnesses need their own sign-ins; the run then fails at those modes' **host** legs and walks the rest.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-28 | 56843f61cd | n/a | NOT GRADED (host) | Cloud container, root, no Codex or Cursor sign-in, no AI Gateway key. **cc:host**, **cx:host** and **cu:host** failed with the picker's reasons (root; Codex not logged in; no `CURSOR_API_KEY`), so no coding mode was walked. Flow State was walked, and its turns failed with no model (`fs:l`, `fs:c`, `fs:r`); `fs:own` passed. Needs a signed-in, non-root host (`fsd-qa`) |
| 2026-10-28 | 56843f61cd + this goal | scripted (`GOAL_SCRIPTED=1`) | dry run, not a verdict | All four modes walked on the scripted harnesses. The plumbing held: each tab's session and bound id read, the same id after turn 2 and after the reload in every harness mode, every tab back in its session after the reload, `cx:p` and `cx:kept` read "Codex reports no plan.", and **own** passed in all four. As expected for scripts, **c**, **r**, `cc:p` and `cu:p` failed: the scripts neither recall a token nor plan on a free prompt. `cc:l` failed too: the scripted Claude Code answers a free prompt faster than the walk polls (500 ms), so a real run is what grades it |
| 2026-10-28 | 56843f61cd + this goal, `own` reads its own row | scripted (`GOAL_SCRIPTED=1`) | dry run, not a verdict | **own** now first waits for the mode's own session in its rail, so a rail still loading, erroring or empty fails instead of passing. On the run before, `fs:own` had passed with no row at all: the reload had closed the assistant's rail row. With the row reopened, **own** passed in all four modes on their own rows. **l** failed in all four this time: the scripted turns finish inside the 500 ms poll, so the real run still grades it |
| 2026-10-28 | main 0d55d4666c merged + this goal | scripted (`GOAL_SCRIPTED=1`) | dry run, not a verdict | **l** is now read by an observer in the page, installed before each send, so a reply drawn and finished between two polls still counts. **l** passed in all four modes. A turn still running at its deadline now fails its leg; with the deadline cut to 0 on a scratch copy, every turn failed its leg that way. Main was merged in because a harness mode refuses to start a run from a checkout that has diverged from `origin/main` |
