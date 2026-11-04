# teammates-lab › its first run shows what it works on

**Issue:** FIX-2403 (epic FIX-2369), leg b

**Outcome:** A person opening the Teammates lab sees, over the conversation, the folder the lab
works in, the model the teammates answer on and the default coding harness, as the lab was
started. Chips say which coding harnesses can run on this machine, and what to run for one that
can't; after the person does it and presses Re-check, the chip turns ready. An empty
conversation offers lines to start with; a click puts one in the composer and sends nothing.

**Input:** `fixtures/input.json`: the lead worker's name, the default harness the run starts the
lab on (`claude-code`, not the lab's default), and the remedy the Codex chip names. The run picks
the working folder's name and the model (`openai/goal-model-<n>`) at random, so no lab file holds
them.

**Signal:** one browser on `fsdev dev --app <pages>`, a fresh store, a fresh git checkout as the
working folder, the pages built from a scratch copy of the lab's source. Cursor is ready on a
`CURSOR_API_KEY`; Codex is not (no `CODEX_API_KEY`, `CODEX_HOME` an empty folder).

- **strip**: the Working context region shows the folder, model and default harness the run set.
- **codex-chip**: the Codex chip reads not ready and names `codex login`. The run then logs Codex
  in through the SDK's own program into that `CODEX_HOME` and presses Re-check; the chip reads
  ready within 30s.
- **starter**: clicking the first starter line in Chief of Staff's empty conversation puts it in
  the composer, and Chief of Staff's session gets no request within 3s.

**Anti-game:** the folder and model are random per run, so a strip that doesn't read the lab
can't show them. The Codex sign-in really changes between the two reads, through Codex's own
program, so chips that don't read the machine can't pass **codex-chip**. **starter** counts
requests on the server, read through the public client, not the page.

**Model:** n/a. No turn runs.

**Shared:** the lab's boot is `goals/teammates-lab/lab.mts`.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/teammates-lab/first-run-shows-its-context/run.mts`

**Controls:**
- `GOAL_CONTROL=fixed-chips`: the pages' adapter answers the chips from a constant list where
  every harness is ready. Must FAIL **codex-chip**.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-04 | e2307a57 + this change, pre-commit | none | PASS | strip showed `folder …/site-1389`, `model openai/goal-model-3289`, `default harness Claude Code`; Codex chip `✗Codex: Run \`codex login\`, or set CODEX_API_KEY`, then ✓ after login and Re-check; "What can the team do for me?" in the composer, nothing sent |
| 2026-11-04 | same | none | control `fixed-chips`: FAIL **codex-chip** as required | The Codex chip read `✓codex` before any login |
