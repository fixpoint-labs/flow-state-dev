# POC · where the four own-session helpers are used

Retained design evidence for [FIX-2624](../../SPEC.md). A read-only checker, outside every
default build, test and lint run: nothing under `specs/` is in a package's vitest `include` or
`tsc` roots, ESLint ignores `specs/**/poc/**`, and fallow ignores `specs/**`.

```bash
bash specs/issues/FIX-2624/poc/helper-inventory/run.sh              # PASS on main
POC_PLANT=1 bash specs/issues/FIX-2624/poc/helper-inventory/run.sh  # the planted control: must FAIL
```

## The question

What does each use of `ownSession` (claude-code-style), `labSession` (teammates), workforce's
roster session and `readerSessionId` (Shift Manager) need instead, and which of them need a view
(FIX-2623) before the helper can go? [D1](../../DECISIONS.md#d1) rests on the answer.

## How it checks

`git grep` finds every line of product source (no tests, no goals) that names a helper. Each line
must match one rule, which gives it a class; a line no rule matches fails the run (totality), and
so does a rule that matches nothing (a count of a use that's gone). The control plants an
unclassified `ownSession` call, and the run must fail on it.

## What it showed · 2026-11-11, on `main` at `f0b34c52`

PASS: 96 lines found, every one classified, every rule matching. The planted control failed,
naming the planted line.

| Class | Lines | Becomes |
|---|---|---|
| helper | 31 | deleted with the helper |
| direct-read | 14 | a direct read by scope and key |
| runby-write | 9 | a send to the resource's `runBy` flow |
| identity | 3 | the identity read (the same three lines also read the roster) |
| view | 7 | a view, so FIX-2623 first |
| carrier | 22 | Shift Manager props and params that pass the id along; they go with it |
| unrelated | 13 | the same word, another meaning (a run's own session, the roster flow) |

The seven *view* uses: claude-code-style's harness readiness and repository check; teammates'
lab context and harness readiness; Shift Manager's project setup, routines list and usage.
