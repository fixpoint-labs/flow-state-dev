# POC · live membership

A throwaway experiment retained as design evidence for [FIX-1779](../../SPEC.md). It is not
production code, not a workspace package, and is in no default build, test, lint or knip
discovery. Nothing outside this folder imports it.

## The question

Can a mailbox post wake a worker that was registered after the wake was built (a fresh hire),
and a member that was written into the mailbox after it opened, without a change to core or
engine? If not, the plan needs a new Layer 1 hook, and the spec is a different shape.

## How to run it

```bash
pnpm exec tsx specs/issues/FIX-1779/poc/live-membership/check.mts
```

Exit code is 0 when every check and its control behave. The engine logs each action; the
PASS / FAIL lines are the result.

## What it checks

| Check | The claim | The control |
|---|---|---|
| 1 | A wake that reads the host's live registry on each post reaches a worker registered after it was built. It returns a dispatcher built on first use, which the router's existing `validateRoute` hook accepts | The same run with today's `wakeMemberSeats(bootList)` does not wake that worker. The declared member is woken in both runs, so the control is not simply broken |
| 2 | Delivery reads members from the mailbox session on each post: a member written after open is not woken before it is written, and is woken on the next post after | The same as 1: before the write, the new worker is not woken |

## Result (2026-10-04)

All six assertions behaved. The premise held: the wake needs a getter, not a new hook.
