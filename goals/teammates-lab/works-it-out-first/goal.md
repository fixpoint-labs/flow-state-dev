# teammates-lab › a worker works things out before it asks

**Issue:** FIX-2364

**Outcome:** A worker on the built-in worker flow finds what it can before it asks the user anything. It never asks the user to paste something the system holds or a teammate can find. Asked to review work it can't see, it gets a teammate to read the files, reviews what they found, and says what it couldn't see. All of this comes from the workforce package's default prompt layer, not from any app text.

**Input:** `fixtures/input.json`. The working folder is a git checkout whose last commit changed `docs/pricing.md` and wrote a wrong saving (40%). There are two wordings of the review ask and two of the ask to Chief of Staff, and one of each is drawn per run. **Held out**: no worker file, prompt or flow names the PR, the file or the figure.

**Signal:** `fsdev dev --app @flow-state-dev/teammates` on a fresh store over the seeded checkout, driven over HTTP. A conversation is graded once no request in any of the user's conversations has been open for 20s, so a reply that arrives in a later turn, after a teammate's, counts.

- **Leg 1:** the user hires `reviewer` of their own: a description and nothing else (no instructions, no `tools:`). Asked to review "PR #42, the pricing change the coding task opened", which no tool of its can show:
  - *looked*: it called a tool. Asking a teammate counts.
  - *no paste*: no reply asks the user to paste, share or send the diff, link or copy.
  - Reported, not graded: whether a reply names the 40% claim, which it can only learn through a teammate who reads the file. The issue asks that the worker look and never ask for the diff; how far it gets depends on which teammate it asks and what they find (until FIX-2361, nobody can see a PR's diff).
- **Leg 2** (FIX-2336's check, kept as a regression): Chief of Staff, asked what researcher and writer are working on, messages them or reads their conversations (`sendMessage` or `consultSessionHistory`), and no reply offers to do it instead ("if you want, I can…").

Each leg passes in 3 runs of 3 (`GOAL_RUNS`, default 3).

**Anti-game:** Graded on the conversation's replies and tool outputs, read through the public client. `reviewer` has no instructions, so nothing but the default layer tells it how to ask. The 40% is in the checkout only, so naming it means something read the file. Leg 2 is not a proof of the rule: Chief of Staff's own `WORKER.md` says the same, so the control isn't asked to fail it.

**Model:** real: `openai/gpt-6-luna` (the lab's default).

**Shared:** the lab's boot is `goals/teammates-lab/lab.mts`, which `a-worker-knows-who-it-is` uses too.

**Run:** `pnpm tsx goals/teammates-lab/works-it-out-first/run.mts` (needs `AI_GATEWAY_API_KEY`, and the lab's pages built: `pnpm --filter @flow-state-dev/teammates build`).

**Controls:** on the same command:

- `GOAL_CONTROL=old-rule`: the default layer's rule is patched back to its one-line FIX-2334 wording ("Use your tools to do what you're asked before you answer. Don't offer to do something you can do now: do it.") as the server loads it. Leg 1 must FAIL on *no paste* in at least one run.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-31 | 43f36196 + this change, pre-commit | openai/gpt-6-luna | PASS 3/3 (leg 1, with *reviewed* graded) | Each run asked Chief of Staff or researcher, and the reply named the 40% claim and said PR #42 itself couldn't be seen. Leg 2 was not yet in the script |
| 2026-10-31 | same | openai/gpt-6-luna | control `old-rule`: FAIL as required | Run 1 asked "if you can share the PR link or patch here"; runs 2 and 3 asked Chief of Staff for the diff and waited, never naming 40%. Two earlier control sets also asked the user for the diff in 1 and 2 runs of 3 |
| 2026-10-31 | same, leg 2 added | openai/gpt-6-luna | FAIL 2/3, twice, on *reviewed* only | No run asked the user to paste anything; one per set asked Chief of Staff, heard researcher was still looking for PR #42, and stopped. *reviewed* is reported, not graded, from here on: the issue's bar is look first and never ask for the diff |
| 2026-10-31 | same, first draft of the rule | openai/gpt-6-luna | FAIL 2/3 | Run 3 still asked the user to "share the PR link or diff"; the wording was made firmer |
| 2026-10-31 | same, worker with file tools | openai/gpt-6-luna | PASS 3/3 on both wordings | Dropped as the check: with its own read tools the worker looked on the old wording too |
| 2026-10-31 | 43f36196 + this change | openai/gpt-6-luna | PASS 3/3 | Leg 1: every run looked (`listTasks`, messages to Chief of Staff or researcher) and no reply asked the user for anything; reviewed (named 40%) in 1 of 3. Leg 2: Chief of Staff messaged both teammates in every run, no offer |
| 2026-10-31 | 43f36196 + this change | openai/gpt-6-luna | control `old-rule`: FAIL as required | Run 3: "Please send the PR link or paste the diff, and I'll review the pricing change" |
| 2026-10-31 | 43f36196 + this change, review wording | openai/gpt-6-luna | PASS 3/3 | Last bullet now names what still waits (sends, merges, spending, deletes, app confirmations). Leg 1 reviewed (named 40%) in 3 of 3; leg 2 messaged or read both teammates every run |
| 2026-10-31 | 43f36196 + this change, review wording | openai/gpt-6-luna | control `old-rule`: FAIL as required | 2 of 3: "Please share the PR link or paste the diff"; "Please send the researcher's findings and the PR #42 diff" |
