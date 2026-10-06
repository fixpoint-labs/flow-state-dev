# Census · every retired Workforce term, counted and classified

The factual base of [FIX-1796](../../SPEC.md) and the shape of its goal check, re-derived by a
script rather than counted by hand. Not production code; outside default discovery
([specs/README.md](../../../../README.md)). The last implementation PR moves it to
`scripts/check-retired-terms.mjs` ([PLAN](../../PLAN.md) S10).

## How to run it

```bash
node specs/issues/FIX-1796/poc/term-census/check.mjs              # the census; exits 1 while any line is unswept
node specs/issues/FIX-1796/poc/term-census/check.mjs --list seat  # every unswept line of one term
node specs/issues/FIX-1796/poc/term-census/check.mjs --control    # must print CONTROL PASS
```

It reads every tracked file. **Totality, twice:** each file falls in exactly one area, in scope
or kept (history, process, `goals/`, root configuration), or the run fails naming it; and each
match of a retired term on an in-scope line is either stripped by a named exception or counted
as unswept. Exceptions strip a token, never a line, so a second retired word on the same line
still counts. "Kind", "owner pin" and "flow instance" are scanned on Workforce's ground only.

`--control` adds, in memory, one planted file whose three lines each hide a retired word behind
an exception that covers its neighbour ("the agent kind" beside `flowKind`; "the mailbox" beside
`MAILBOX.md … WORKER.md`; "each seat" beside the stored name `"inventory/seats/x"`), and one file
in a folder no area names. Each must be refused.

## What was observed

On `cad4e2780`: **FAIL**, as it must before the sweep. 5,790 tracked files, every one with an
area; 21,436 unswept lines in 661 files.

| Term | Lines | Files | Unswept lines |
|---|---|---|---|
| seat | 9,989 | 460 | 9,940 |
| mailbox | 5,774 | 266 | 5,744 |
| kind (Workforce ground) | 4,256 | 257 | 3,217 |
| person | 898 | 289 | 898 |
| room | 874 | 70 | 824 |
| talk session | 298 | 37 | 298 |
| hired roster | 282 | 55 | 278 |
| flow instance (Workforce ground) | 333 | 95 | 128 |
| owner pin (Workforce ground) | 109 | 24 | 109 |

By folder: `workforce` 176 files, `shift-manager` 112, `kitchen-sink` 61, `orchestration` 48,
`engine` 33, the Workforce docs 29, then a long tail. The exceptions stripped 1,288 field names
called `kind`, 211 uses of core's `FlowInstance` type, 184 stored names (D2), 35 "a kind of", 33
"room for", 15 `MAILBOX.md` beside `WORKER.md`, 3 other kinds; `channel-kind-paths` stripped
nothing, because no such path is tracked.

`--control`: **CONTROL PASS**, all four plants refused.

Most of today's lines are in code the other children rewrite or remove first, so these are a
baseline, not the sweep's size: re-run on the build commit.
