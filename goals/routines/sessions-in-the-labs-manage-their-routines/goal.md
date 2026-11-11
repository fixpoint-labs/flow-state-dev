# routines › sessions in the labs manage their routines

**Issue:** FIX-2539
**Outcome:** In each of the three labs (Teammates, Claude Code Style, DevTeam), a user asks a conversation worker in words to follow a GitHub pull request or run something on a clock. The worker saves the routine with its own tools. Shift Manager's Routines lists it as made by that worker. A review on the PR reaches the same session once, within one poll of the served app's own tick. A paused routine delivers nothing, a resumed one delivers again, and a deleted one is gone. A clock routine files one task at its time. GitHub is read with the operator's token for the lab's own user only, and anyone else's GitHub routine is refused, naming `GITHUB_TOKEN`.
**Input:** Each lab opened by its own open function (`openTeammates`, Claude Code Style's `openLab`, DevTeam's `openLab`) over a fresh SQLite store, then served with `@flow-state-dev/node`'s `serve()`. GitHub is a stub (`stub-github.mts`) at the provider's `apiUrl`. Each host has its own token (`tok-<host>`), never the environment's, and its own repository and PR (`fixtures/hosts.json`: acme/api#412, globex/billing#77, initech/tps-reports#9). The run's clock is moved (`../../webhook-routing/polls-each-event-once-without-a-webhook/clock.mts`). Each beat moves it, then waits 63 s of real time, so `serve()`'s own one-minute tick runs at the moved time. The check dispatches nothing itself.
- **scripted legs (a–f):** only the model is scripted. A conversation turn whose line carries a plan's marker makes that plan's tool calls, one per step, then a closing line. Every tool runs for real. DevTeam's coordinator takes the line itself (Best fit answers its own worker).
- **real-model leg (g):** each lab on `openai/gpt-6-luna` (`AI_GATEWAY_API_KEY`). The operator asks in words to follow the PR, then what it follows, then to stop.

**Signal:** per host, on one run:
- **(a)** the worker's tools save an event routine on the PR, made by that worker for this session, and a clock routine `pr-sweep` (stored subscription and schedule rows);
- **(b)** the roster's `listRoutines`, read through Shift Manager's own `toRoutines` (bundled from `packages/shift-manager/src/lib/routines.ts`), lists both as made by the worker;
- **(c)** a stub review reaches the session exactly once within one poll period of `serve()`'s tick (stored message-log entries from `service:github`);
- **(d)** paused, a review reaches nothing; resumed, the next one arrives once; deleted, the next one reaches nothing and the routine is not listed;
- **(e)** at the clock's next due time, the clock routine files one task (none before);
- **(f)** on DevTeam, a second user's GitHub routine saves nothing, and their session names `GITHUB_TOKEN`; on Teammates and Claude Code Style, which have one user, a session opened naming another user is stored as the lab's own (the host takes no user from the request);
- **(g)** on a real model, asked in words: a live routine on the PR is stored, the worker calls `listRoutines` when asked what it follows, and when asked to stop, no live routine is left.

A failure of a tick-driven signal (c, d resumed, e) says why. It reports the host's answer to the tick's own headers on the schedule listing, a read that runs the same principal resolver as a dispatch. For (e) it also reports the clock routine's row in the clock index.

**Anti-game:** assertions read the stores' SQLite files (subscriptions, schedules, message log, tasks) and the stub's own record of who called GitHub with which token. They never read a tool's answer or the model's reply. (g)'s "listed" reads the session's recorded `tool_output` items, which show what the worker did, not what it said. The tick is `serve()`'s; the check posts no dispatch. Graded lists are floored with `tell.over`, so an instrument that saw nothing reads CAN'T TELL.
**Model:** scripted for a–f; `openai/gpt-6-luna` for g.
**Run:** `pnpm tsx goals/routines/sessions-in-the-labs-manage-their-routines/run.mts` (about ten minutes). Options:
- `GOAL_LEG=scripted|real` runs one half.
- `GOAL_HOSTS=devteam` (comma-separated) picks hosts.
- `GOAL_DEBUG=1` logs each scripted turn.

An environment whose `FSDEV_DEFAULT_MODEL`/`FSDEV_INTENT_*` name an id the resolver refuses stops every runtime before it starts; unset them.
**Controls:**
- Today's `main`, with the host files and worker trees as on `main`. Must FAIL **(a)**: the workers hold no routine tools.
- `GOAL_CONTROL=no-poll` builds GitHub's service flow without its poll. Must FAIL **(c)**.
- `GOAL_CONTROL=no-clock-index` gives the roster no clock index. Must FAIL **(e)**.
- `GOAL_CONTROL=shared-token` lends the operator's token to every user. Must FAIL **(f)**.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-11 | e2a969b3 (main) | scripted | FAIL (expected) | Today's `main`, all three hosts: (a) `event-saved` and `clock-saved` on every host, "CAN'T TELL: a · event routines saved: read 0". The scripted `saveRoutine` calls were made; the workers had no such tool. |
| 2026-11-11 | 4257c827 | scripted | FAIL (expected) | Today's `main` host files and worker trees on DevTeam (`GOAL_HOSTS=devteam`): (a) `event-saved` and `clock-saved`, stored `[]`. |
| 2026-11-11 | 4257c827 | `openai/gpt-6-luna` | PASS | `GOAL_LEG=real`: (g) teammates, claude-code-style and devteam each saved, listed and deleted a routine when asked in words. |
| 2026-11-11 | 4257c827 | scripted | FAIL | DevTeam alone: (a)–(d) and (f) pass. (e) fails: the clock index holds `pr-sweep` due 2026-11-16T09:00Z, never claimed, though the tick is admitted (the roster's missing `schedules.index`). |
| 2026-11-11 | 4257c827 | scripted + `openai/gpt-6-luna` | FAIL | All three hosts, both halves. (a), (b), (f) and (g) pass everywhere; DevTeam passes (c) and (d) too. Teammates and Claude Code Style fail (c) and (d) resumed with 0 deliveries, each printing "serve()'s tick is refused by this host: … 401 Action request requires non-empty userId". Every host fails (e): the clock index holds `pr-sweep` due 2026-11-16T09:00Z, never claimed. |
| 2026-11-11 | 4257c827 | scripted | FAIL (expected) | `GOAL_CONTROL=no-poll` on DevTeam: (c) the first review reached the session 0 times; (d) resumed 0; "CAN'T TELL: c · GitHub calls as the operators: read 0". |
| 2026-11-11 | rebased on 650474a4 (with FIX-2674) | scripted | FAIL | All three hosts. DevTeam passes (a)–(f). Teammates and Claude Code Style pass (a), (b) and (f), and fail (c), (d) resumed and (e), each printing "serve()'s tick is refused by this host: … 401 Action request requires non-empty userId". The clock index failure is gone. |
| 2026-11-11 | rebased on 650474a4 | scripted | FAIL (expected) | `GOAL_CONTROL=no-clock-index` on DevTeam: (e) 0 tasks before, 0 after; "the host keeps no clock index; the tick is admitted". |
| 2026-11-11 | rebased on 650474a4 | scripted | FAIL (expected) | `GOAL_CONTROL=shared-token` on DevTeam: (f) u_devforce_member saved `github:initech/tps-reports#9`, and the refusal doesn't name GITHUB_TOKEN. |
| 2026-11-11 | 1c899b66 + labs' resolver | scripted | FAIL (expected) | Before the resolver, Teammates and Claude Code Style: (f) host-identity, a session opened naming another user is stored as that user's. |
| 2026-11-11 | 1c899b66 + labs' resolver | scripted | PASS | `GOAL_HOSTS=teammates,claude-code-style`: (a)–(f) pass. Each lab resolves every request to its own user in its own org, so serve()'s tick is admitted and (c), (d) resumed and (e) go green. |
