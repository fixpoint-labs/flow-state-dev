# kitchen-sink-harness › each harness runs the model its session picked

**Issue:** FIX-1952 (epic FIX-1907)

**Outcome:** A person starting a Claude Code, Codex or Cursor session in Kitchen Sink picks the model it runs, and every turn of that session, resumes included, runs that model or fails in the harness's own words. Nothing quietly runs another model.

**Input:** per mode, the second model in New session's picker (not the preselected default); any other listed model must pass too. The refused leg starts a session through the session API with a fresh random id no harness has ever had (`no-such-model-<hex>`). A durable store (`STORE_TYPE=filesystem`). `KITCHEN_SINK_HARNESS_WORKSPACE` unset on a development server, so the checkout the server runs in is the repository.

**Signal:** one real browser against `next dev`, with the real harnesses (`KITCHEN_SINK_REAL_HARNESS=1`) on a host signed in to all three. Per mode, turns 1 and 2, a reload, then turn 3:

- **`<mode>.m`**: after every turn, the harness's own record of the conversation has grown, and every model it records equals the picked id.
  - **Claude Code**: its session transcript (`$CLAUDE_CONFIG_DIR`, else `~/.claude`, `projects/*/<conversation>.jsonl`): each assistant entry's `message.model`, which is what the API answered with, so the model that served the turn.
  - **Cursor**: its local run records for the agent (`Agent.listRuns(<agent>, { runtime: "local", cwd: <session worktree> })`): each run's `model.id`.
  - **Codex**: its session file (`$CODEX_HOME`, else `~/.codex`, `sessions/**/rollout-*<thread>.jsonl`): each `turn_context` entry's `model`. **This is the model Codex asked its backend for, not the one that served the turn**: Codex records the requested slug and never the served one (openai/codex#47779). So the Codex leg proves the pick reaches Codex on every turn and resume, and no more. That OpenAI served it is outside what Codex lets a check see; the refused leg below is the backstop that the slug reaches the backend unaltered.
- **`<mode>.h`**: the session header names the picked id (`session-model`'s `data-model-id`), after the reload too.
- **`<mode>.x`**: a session born with an id the harness has never had: its turn fails with a notice of kind `error` carrying the harness's own words (Kitchen Sink's fallback line for a failed run the harness gave no reason for, "The harness reported the run as failed.", does not count), and the harness's record shows no model other than that id (Claude Code: no assistant entry from a real model; Cursor: no run on another model; Codex: no `turn_context` naming another model and no agent message).

**Anti-game:** never assert on the session's stored model, the block's options, Kitchen Sink's own log, or a scripted harness: all of them pass while the harness runs its default. **h** reads Kitchen Sink's state on purpose and so stays green under the control; it is graded only for the header, never as evidence of the run. The picked model is never the preselected one, so a feed that ignores the pick cannot pass **m** by coincidence.

**Model:** each harness's own: the second entry of the picker, which depends on the signed-in account (Claude Code, Cursor) or Kitchen Sink's Codex list. The prompts ask for one short sentence; no assertion depends on what the model says.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-harness/runs-the-picked-model/run.mts` (optionally `GOAL_MODES=codex,cursor` to grade a subset).

**Controls:** on the same command.

- `GOAL_CONTROL=ignore-model`: the session flow's model feed hands every harness the mode's default (Cursor: `composer-2.5`; Claude Code and Codex: nothing, so their own default) whatever was picked. **`<mode>.m`** FAILS in every mode (the record names the default), and **`<mode>.x`** FAILS in every mode (the harness runs its default instead of refusing). **`<mode>.h`** stays green.
- Today's `main` (before FIX-1952) FAILS at the first picker read: there is no `model-picker`.

**Host:** a mode Kitchen Sink shows as unavailable here fails at **`<mode>.host`** with the picker's reason, and its other legs are not graded.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-14 | FIX-1952 branch on `24a3cb8dc` | n/a | NOT GRADED (host) | No harness signed in in the implementing container, and the server runs as root: the run stopped at **claude-code.host** ("The server runs as root…"), **codex.host** ("Codex is not signed in…") and **cursor.host** ("Cursor is not signed in…"), grading nothing else. The same picker, New session and header path was driven in a real browser against the scripted harnesses (not the goal's verdict): each mode's picker offered its list, the second Codex entry (`gpt-5.6-terra`) was born into the session and shown in the header before and after a reload. Owed: a run on a host signed in to all three, and the `ignore-model` control seen to FAIL there |
