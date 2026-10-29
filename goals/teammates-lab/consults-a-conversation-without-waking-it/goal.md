# teammates-lab › it consults a conversation without waking it

**Issue:** FIX-2173

**Outcome:** A worker answers a question from what the user already said in another of their conversations, in its own turn, without waking that conversation: it runs nothing there and writes nothing there. Another user's conversation is refused as one that doesn't exist. The same holds in the Claude Code-style lab, between two of the user's sessions.

**Input:** `fixtures/input.json`: two wordings (a venue, a booth number), each a line to say and a question to ask, and the leg 2 and leg 3 questions. The value is drawn each run (`Hall K-41`-shaped, a new letter and number every time), so it is in no worker file, project or other conversation. **Held out**: another wording and value pass a correct lab.

**Signal:** `fsdev dev --app @flow-state-dev/teammates` on a copy of the lab's workers and a fresh store, and `fsdev dev --config labs/claude-code-style/fsdev.config.mts` on a fresh data folder, driven over HTTP.

- **Leg 1** (Teammates): the user says the line to `teammates.writer` in writer's conversation, then asks `teammates.lead` the question in lead's.
  - *value named*: lead's reply contains the value.
  - *reading names it*: a consult in that turn returned a reading that contains the value. The lab's memory (user-scoped episodic and semantic facts) also carries what writer heard to lead, so lead can name the value with no consult at all; the reply alone proves nothing here.
  - *writer not woken*, *writer unchanged*: writer's conversation has the same number of requests and items as before the question.
  - *no message*: the message log has no row.
  - *utility model*: the consult's answer ran on `gpt-6-luna`, the lab's `models.intents.utility`, not lead's model. Its message is kept off the client, so this one is read from the lab's SQLite store.
- **Leg 2** (Teammates): a second user asks their own lead to read the first user's writer conversation by its id.
  - *no value*: neither the reply nor the consult result holds the value.
  - *refused no_session*: the turn holds a consult refused `no_session`. A turn with no consult FAILS; it does not pass on the model declining.
- **Leg 3** (Claude Code-style): the user says the line in `desk.main` session A, then in session B asks what they said in session A, by its id.
  - *value named*: B's reply contains the value.
  - *A not woken*: A has the same number of requests as before.

Each leg passes in 3 runs of 3 (`GOAL_RUNS`, default 3).

**Anti-game:** Graded on the replies, the sessions' requests and items, the message log, and the store. The value is drawn per run. In the Teammates lab it reaches lead two ways, a consult and the lab's user memory, so leg 1 also needs a consult's reading that holds it and the consult's answer on the utility model. The Claude Code-style lab has no memory, so in leg 3 only a read of session A produces the value.

**Model:** real: `openai/gpt-5.4-mini` (Teammates), `openai/gpt-5.4` (Claude Code-style), consults on `openai/gpt-6-luna`.

**Run:** `pnpm tsx goals/teammates-lab/consults-a-conversation-without-waking-it/run.mts` (needs `AI_GATEWAY_API_KEY`; build both labs' pages first: `pnpm --filter @flow-state-dev/teammates build`, `pnpm --filter @flow-state-dev/claude-code-style build`).

**Controls:** each on the same command:

- `GOAL_CONTROL=no-consult`: lead's file (in the goal's copy of the tree) doesn't name `consultSessions: [consult]`. Leg 1 must FAIL on *reading names it* and *utility model*; *value named* can still pass, from memory. Leg 2 FAILS too (no consult call); leg 3 is not run.
- `GOAL_CONTROL=no-owner-check`: the engine's owner rule, shared by `sessions.read` and `sessions.history`, skips its user check as the server loads it (a scratch patch to `request-sessions.ts`). Leg 2 must FAIL on *no value*. Leg 3 is not run.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-29 | 1052e82f+ | openai/gpt-5.4-mini, openai/gpt-5.4, gpt-6-luna | PASS | 3 of 3 runs, before *reading names it* was added; every consult ran on gpt-6-luna; writer 1/8 → 1/8 requests/items; session A 1 → 1 |
| 2026-10-29 | 1052e82f+ | openai/gpt-5.4-mini | FAIL (expected) | `no-consult`: only [1] *utility model* and [2] *refused no_session* red; lead still named the value, from the lab's user memory. Led to *reading names it* |
| 2026-10-29 | 1052e82f+ | openai/gpt-5.4-mini | FAIL (expected) | `no-owner-check`: [2] *no value* (the consult read the other user's conversation and returned its value) and *refused no_session* |
| 2026-10-29 | 1052e82f+ | openai/gpt-5.4-mini, openai/gpt-5.4, gpt-6-luna | PASS | 3 of 3 runs with *reading names it*; both wordings drawn; writer 1/8 → 1/8; session A 1 → 1 |
| 2026-10-29 | 1052e82f+ | openai/gpt-5.4-mini | FAIL (expected) | `no-consult`: [1] lead messaged writer instead (writer 1 → 3 requests, 2 log rows), no reading, no utility model; [2] no consult |
