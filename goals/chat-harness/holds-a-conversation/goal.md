# chat-harness › it holds a conversation

**Issue:** FIX-875
**Outcome:** A developer can hold a multi-turn conversation with a real flow from the terminal — messages stream back live, and state persists across turns so a later turn can use what an earlier one established.
**Input:** `fixtures/conversation.json` — a held-out `{ name, statement, question }`. The name is stated in turn 1 and asked for in turn 2; swapping "Ada" for any other name must still pass a correct implementation, because nothing below hardcodes it.
**Signal:** `fsdev chat hello-chat chat` fed the statement, then `/status`, then the question, then `/status`, then `/exit`, over piped stdin against the real `openai/gpt-5-mini` wiring of `examples/hello-chat`. PASS requires: exit 0; both `/status` blocks present (`Turns:   1` then `Turns:   2`, naming the session id and `hello-chat · chat`); and the assistant reply to the **question** (the transcript segment between the two `/status` blocks) contains the fixture name.
**Anti-game:** The question turn's input does NOT contain the name, so the model can only answer it from turn-1 history. The check therefore isolates the *second* reply (via the intervening `/status` block) and grades only that segment — never the whole transcript (turn 1's acknowledgement may echo the name) and never mere message presence. A hollow pass — printing something, or the name leaking from the current prompt — is ruled out.
**Model:** real — `openai/gpt-5-mini` (via `examples/hello-chat`; needs a provider key, e.g. `AI_GATEWAY_API_KEY` or `OPENAI_API_KEY`). Out of CI.
**Run:** `pnpm tsx goals/chat-harness/holds-a-conversation/run.mts`

A short manual TTY checklist (not exercisable through a pipe):

- Idle prompt shows `❯ `; a streaming reply owns stdout with no stray prompt.
- Ctrl-C while idle prints `(press Ctrl-C again or /exit to quit)`; a second exits.
- Ctrl-C during a streaming turn aborts that turn (prints `(interrupted)`) and re-prompts; the next turn still works.
- Ctrl-D exits cleanly.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-07-10 | claude/fix-875-e05uaa | openai/gpt-5-mini | PASS | Turn 1 "My name is Ada." → "Nice to meet you, Ada."; turn 2 "What is my name?" → "Ada" (the question carried no name, so it came from turn-1 history); both /status blocks named the session and hello-chat · chat; exit 0. |
| 2026-07-25 | 5eb5e7e | hello-chat configured model | PASS | The answer to the isolated question contained `Ada`, recovered from turn-1 history. Run during the goals/lib migration (runner scaffolding only; no product code changed). |
