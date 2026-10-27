# FIX-2250: Agent-started dev servers die when the Cursor turn ends

**Linear:** [FIX-2250](https://linear.app/fixpoint-labs/issue/FIX-2250) · **GitHub:** [#3984](https://github.com/fixpoint-labs/flow-state-dev/issues/3984)

**Project:** Workforce: Shift Manager

## Problem

When Kitchen Sink (or Shift Manager / a lab) is run via `pnpm dev` from a **Cursor agent shell** in a harness worktree, the process often exits within seconds of the agent turn finishing—even though Next.js reported Ready and served requests.

Harness terminal metadata shows `status: aborted` and `exit_code: unknown`, with no Next.js crash. That matches the agent tearing down the shell session, not the app failing.

## Impact

Manual verification of worktree changes fails: the agent reports a URL, then localhost stops responding after the turn ends. Developers must learn to start dev in a **user-owned** IDE terminal.

## Desired direction

- Document the durable path (user terminal; optional detached script with known port/log).
- Optionally integrate with harness/Cursor so preview URLs do not depend on agent process lifetime.

## Context

- Worktrees under `~/.local/state/flow-state-dev/kitchen-sink-harness/…`
- Observed: Kitchen Sink `next dev`, `PORT=3001`, `KITCHEN_SINK_TEST_MODE=1`
- Surfaced while testing composer draft persistence ([PR #3963](https://github.com/fixpoint-labs/flow-state-dev/pull/3963))

No full spec yet; filing issue only.
