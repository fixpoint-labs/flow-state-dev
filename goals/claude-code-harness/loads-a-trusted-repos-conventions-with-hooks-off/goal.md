# claude-code-harness › it loads a trusted repo's conventions with hooks off

**Issue:** FIX-2421
**Outcome:** A host that trusts the repository a Claude Code run works in sets
`settingSources: ["project"]` and `settings: { disableAllHooks: true }`. The run follows the
repository's `CLAUDE.md` and sees its skills, and the repository's hooks never run.
**Input:** A git repository the check writes fresh each run: a `CLAUDE.md` holding a code word
generated for that run, one project skill (`zebra-check`), and a `.claude/settings.json` whose
`UserPromptSubmit` and `SessionStart` hooks touch a marker file. Held-out: the code word is new
every run, so no answer can be baked in.
**Signal:** Two real turns through `claudeCodeAgent`, each with every file, search and shell tool
disallowed.
- `conventions:code-word` — the first turn's answer contains the run's code word.
- `conventions:skill` — the second turn answers YES to whether `zebra-check` is listed.
- `hooks:off` — after both turns no marker file exists.
**Anti-game:** The code word is asked for with `Read`, `Grep`, `Glob`, `Bash` and sub-agents
disallowed, so only instructions the run loaded can answer it. The hook is graded on the marker
file the hook itself would write, never on `settingSources`, `settings` or the options the block
handed the SDK. Two hook events, so a hook on one event the switch missed still writes the marker.
**Model:** real — Claude Code's own default (no `model` option), on a host where Claude Code can
reach a model.
**Run:** `pnpm tsx goals/claude-code-harness/loads-a-trusted-repos-conventions-with-hooks-off/run.mts`
**Controls:**
- `GOAL_CONTROL=hooks-on` — no `settings`, the trusted sources alone. Must fail `hooks:off`.
- `GOAL_CONTROL=untrusted` — `settingSources: []`. Must fail `conventions:code-word` and
  `conventions:skill`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-31 | fix-2421-pr1 | Claude Code default (CLI 2.1.316, Agent SDK 0.3.234) | FAIL (expected) | `GOAL_CONTROL=hooks-on`: fails `hooks:off` only; code word and skill both answered. |
| 2026-10-31 | fix-2421-pr1 | Claude Code default (CLI 2.1.316, Agent SDK 0.3.234) | FAIL (expected) | `GOAL_CONTROL=untrusted`: fails `conventions:code-word` ("NONE") and `conventions:skill` ("NO"); no marker. |
| 2026-10-31 | fix-2421-pr1 | Claude Code default (CLI 2.1.316, Agent SDK 0.3.234) | PASS | Code word answered with reading tools off, skill listed, no marker after two turns. |
