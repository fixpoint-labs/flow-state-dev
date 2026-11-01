# kitchen-sink-harness › a trusted session follows the repo

**Issue:** FIX-2421 (app PR; epic FIX-2369)

**Outcome:** An operator who marks Kitchen Sink's repository as trusted (`KITCHEN_SINK_HARNESS_TRUSTED=1`) gets Claude Code sessions that follow the repository's `CLAUDE.md`, see its skills and can use the keys they named (`KITCHEN_SINK_HARNESS_PASS`). The repository's hooks never run, and each session's header says what loaded. A request that claims trust changes nothing.

**Input:** a git repository the check writes and commits fresh each run: a `CLAUDE.md` holding a code word generated for that run, one project skill (`zebra-check`), and a `.claude/settings.json` whose `SessionStart`, `UserPromptSubmit` and `Stop` hooks touch a marker file outside the checkout. A named key whose value is new every run. Held-out: no answer can be baked in.

**Signal:** three real turns of one session through Kitchen Sink's own Claude Code session flow (`claudeCodeSessionFlow`, the flow `/claude-code` serves), with trust read from the server's environment by Kitchen Sink's reader.

- `conventions:code-word`: the first turn's answer contains the run's code word.
- `conventions:no-tool`: the first turn used no tool, read off the SDK's own messages.
- `conventions:skill`: the second turn answers YES to whether `zebra-check` is listed.
- `keys:named`: the third turn prints the named key's value with `printenv`.
- `hooks:off`: after three turns no marker file exists.
- `header`: the line the page shows reads "Repo conventions: loaded, hooks off" and names the key.

**Anti-game:** the code word is asked for first, and the turn fails if it used any tool, so a `Read` can't pass it. The hook is graded on the marker file the hook itself would write, never on `settingSources`, `settings` or the options Kitchen Sink built. Three hook events, so a hook on one event the switch missed still writes the marker. Every turn's input carries `trusted: true` and `settingSources: ["project"]`: under the `untrusted` control they must not load anything.

**Model:** real: Claude Code's own default, on a host where Claude Code can reach a model.

**Host setup:** none on a signed-in workstation. On a host where Claude Code's sign-in is in variables outside its package's pass list (a proxied container), name them in `GOAL_HOST_PASS` (for example `ANTHROPIC_BASE_URL`); the check adds them to each run's environment beside what Kitchen Sink passed, so the untrusted control still reaches a model. Where the process runs as root, Claude Code can't skip permissions: `GOAL_PERMISSION_MODE=default` runs the turns in Claude Code's default mode with `printenv` allowed. It changes how tools are approved, not what the run loads.

**Run:** `pnpm tsx goals/kitchen-sink-harness/a-trusted-session-follows-the-repo/run.mts`

**Controls:** on the same command.

- `GOAL_CONTROL=hooks-on`: the trusted run gets no hooks-off layer. Must FAIL `hooks:off` (and `header`, which then reads "loaded, hooks on").
- `GOAL_CONTROL=untrusted`: the server reads as untrusted whatever its settings say, while every turn still claims trust. Must FAIL `conventions:code-word`, `conventions:skill`, `keys:named` and `header`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-01 | fix-2421-pr2 | Claude Code default (CLI 2.1.316, Agent SDK 0.3.234) | FAIL (expected) | `GOAL_CONTROL=untrusted`: fails `conventions:code-word` ("NONE"), `conventions:skill` ("NO"), `keys:named` ("NONE") and `header` ("not loaded", no keys), with every turn claiming `trusted: true`. Container as root: `GOAL_HOST_PASS=ANTHROPIC_BASE_URL GOAL_PERMISSION_MODE=default` |
| 2026-11-01 | fix-2421-pr2 | Claude Code default (CLI 2.1.316, Agent SDK 0.3.234) | FAIL (expected) | `GOAL_CONTROL=hooks-on`: fails `hooks:off` and `header` ("loaded, hooks on") only. A first run of this control also answered "NONE" to the code word, a model miss; the rerun named it |
| 2026-11-01 | fix-2421-pr2 | Claude Code default (CLI 2.1.316, Agent SDK 0.3.234) | PASS | Code word answered with no tool used, skill listed, named key printed, no marker after three turns, header "loaded, hooks off" naming the key. Same host setup |
