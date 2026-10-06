# Checker · what removing rooms touches

The factual base of [FIX-1793](../../SPEC.md)'s removal surface ([PLAN](../../PLAN.md) S7), re-derived
by a script rather than counted by hand. Not production code; outside default discovery
([specs/README.md](../../../../README.md)).

## How to run it

```bash
node specs/issues/FIX-1793/poc/removal-inventory/check.mjs            # the inventory
node specs/issues/FIX-1793/poc/removal-inventory/check.mjs --control  # must print CONTROL PASS
```

It lists every tracked file outside retained specs and internal docs that names a room, a talk
session, the talk template, a workstream claim or the workstream write, and asserts **totality**:
each match is classified as removed whole, edited, or another issue's. An unclassified match
fails the run. `--control` plants an unclassified file naming a room, requires the scan to fail
on it, and removes it.

## What was observed

On `39d7abe13`: **PASS**. 53 matching files: 14 removed whole (1,474 source lines, 1,475 test
lines, 5 figures), 38 edited, 1 left to FIX-1792 (`mailboxes.md`). The control: **CONTROL
PASS**, the planted file refused. The first run caught one file the hand list had missed,
`cas-retry.ts`, whose header names the room's writers; the retry itself stays.

The epic's "about 2,200 lines out" was an estimate; the whole-file removals are about 1,500 source
lines, with the room branches of the mailbox flow and the room parts of the Shift Manager
project view on top. Claims are not removed here ([decided, not asked](../../DECISIONS.md#decided-not-asked)).
