# coordinators › it routes a follow-up by its conversation

**Issue:** FIX-1828 (epic FIX-1786).

**Outcome:** a person asks a best-fit support coordinator something, a specialist answers, and the person follows up with a post that only makes sense in that conversation ("It sees it. It fails right after the password."). The follow-up reaches the specialist that answered, even when its words alone point at another one, because best fit reads the post with the conversation's recent lines.

**Input:**

- `fixtures/workforce/`: one team, a coordinator `support.help` on `routing: best-fit` with `fallback: support.general`, over three `agent` specialists, each with the `description:` best fit picks by. `support.accounts`'s description names passwords and sign-in, `support.devices`'s laptops and wifi.
- `fixtures/threads.json`: each thread is an opener the `on` specialist should answer, and a follow-up whose words alone point at another specialist. The laptop thread's follow-up mentions a password (accounts' words); the sign-in thread's mentions a laptop (devices' words). Held out: another thread of the same shape must pass too, and the check reads the delegates and the expected specialist from the files, never from the code.
- The app is built in `run.mts` the way a new app writes it: `createWorkerInstallation`, `defineAgentWorkerFlow`, `defineCoordinatorFlow` with the built-in `agent` as its delegate flow, `hireWorkforce`, served by the engine's own router on fresh in-memory stores.

**Signal:** each thread runs in a conversation of its own. Failures are tagged `followup:<assertion>`.

- `followup:opener` (setup): the opener is heard by the `on` specialist alone, and its one answer lands. Without it there is no thread to follow up, so the attempt fails here rather than grading the follow-up.
- `followup:delegate`: the follow-up, posted after the opener's answer landed, is heard by the `on` specialist alone.
- `followup:evaluated`: the follow-up's routing record says `by: evaluated`. Best fit's evaluation placed it; no hold did.
- `followup:answered`: one answer to the follow-up lands, by the specialist that heard it.

**Anti-game:** a follow-up sent while the specialist is still working is held for it with no evaluation, which would pass `followup:delegate` without reading any line. So the follow-up is posted only after the opener's answer has landed, and `followup:evaluated` requires the evaluation to have placed it. Who heard a post is read from each delegate's own conversations under the person's (its kept user turn), never from the routing record or the evaluation's answer. Every read goes through the app's router as the person; the engine's stores are read only to wait until nothing runs. The follow-ups carry no routing marks: the real evaluation decides.

**Attempts:** a real model routes differently run to run. The goal runs until it first passes, up to three attempts (`GOAL_ATTEMPTS`), each on a fresh app and fresh stores, every attempt printed. Under a control there is one attempt.

**Model:** real. Best fit's evaluation on `vercel/typesafe-ai/jev` (the app's model string, through its resolver), the specialists' answers on `vercel/openai/gpt-5.4-mini`. Each model needs a key that serves it here (`keysServing`), and only the gateway serves the route model, so the run needs `AI_GATEWAY_API_KEY`. Without it (an OpenAI-only box, say) the goal reports **blocked**, naming the model and the keys that would serve it.

**Run:** `pnpm tsx goals/coordinators/routes-a-follow-up-by-its-conversation/run.mts`

**Controls:**

- `GOAL_CONTROL=no-recent`: best fit's evaluation is handed `{ post }` alone, without the conversation's lines, by wrapping the evaluation model the app names (applied around the model, never inside a package). Must FAIL at **`followup:delegate`** on each thread, and at nothing else: the follow-up is still placed by the evaluation (`followup:evaluated` green) and still answered once (`followup:answered` green).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-09 | `ddaec6167` + this change, uncommitted | route `vercel/typesafe-ai/jev`; answers on the container's `FSDEV_DEFAULT_MODEL` (`vercel/openai/gpt-5-nano`), which the run did not yet strip | PASS | First run. Both threads on attempt 1: the laptop thread's follow-up and the sign-in thread's follow-up each reached the specialist that answered the opener, `by: evaluated`, one answer each. |
| 2026-10-09 | same | same | FAIL (control `no-recent`, expected) | Only `followup:delegate`, on both threads: "It sees it. It fails right after the password." → `support.accounts`; "It's on my laptop, the work one." → `support.devices`. `followup:evaluated` and `followup:answered` green. `support.devices`, never sent the sign-in post, still answered about resetting the password: the delegate is shown the conversation's lines whatever routed it. |
| 2026-10-09 | `334c1e326` + the run's intent-override strip and quiet logger, uncommitted | route `vercel/typesafe-ai/jev`, answers `vercel/openai/gpt-5.4-mini` | PASS | Both threads on attempt 1 of 3, each follow-up to the opener's specialist `by: evaluated`, one answer each. |
| 2026-10-09 | same | same | FAIL (control `no-recent`, expected) | Only `followup:delegate`, on both threads, as above. `support.accounts`, handed the wifi follow-up, answered "since it fails right after the password, please try forgetting the network, reconnecting…": it was shown the lines. |
| 2026-10-09 | `b70a07883` (the lines reach a delegate as one user-role message, a just-landed answer counts as a line; merged with `main` at `6d0e8b915`) | route `vercel/typesafe-ai/jev`, answers `vercel/openai/gpt-5.4-mini` | PASS | Both threads on attempt 1 of 3, each follow-up to the opener's specialist `by: evaluated`, one answer each. |
| 2026-10-09 | same | same | FAIL (control `no-recent`, expected) | Only `followup:delegate`, on both threads: the wifi follow-up → `support.accounts`, the sign-in follow-up → `support.devices`. `followup:evaluated` and `followup:answered` green. |
