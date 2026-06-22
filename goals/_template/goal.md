# <ISSUE-ID> — <one-line title of the outcome>

**Outcome:** <the real-world effect, in the user's terms — what they'd notice>
**Input:** <the fixture, and a note that it's held-out: a different valid input must still pass a correct impl>
**Signal:** <the observable pass/fail, with a threshold — an item, a state value, a return value, a side effect>
**Anti-game:** <what a hollow pass would look like, and what the check must NOT assert on. Required.>
**Model:** real — openai/gpt-5.4-mini
**Run:** `pnpm tsx goals/<issue-id>-<slug>/run.mts`

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| YYYY-MM-DD | <sha> | <model> | PASS/FAIL | <evidence inspected> |
