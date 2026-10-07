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
session, the talk template, a workstream claim or the workstream write, by identifier or in plain
prose, and asserts **totality**: each match is classified as removed whole, edited, another
issue's, or an unrelated use of the word ("make room for", a mailbox id like `ops.room`). An
unclassified match fails the run. `--control` plants an unclassified file that names a room only
in prose, requires the scan to fail on it, and removes it.

It stays runnable after P3 deletes the files it removes (V9): their line counts are stored as a
baseline, and a deleted file is reported as deleted rather than read.

## What was observed

**Amended by [epic D9](../../../../epics/FIX-1786/DECISIONS.md#d9) (2026-10-07):** the classifications no longer keep
anything as a refusal by name or mark claims deprecated; removed calls simply go. The dated
observations below are as first recorded, including BR-31, which D9 removed.

On `dc463ef26`: **PASS**. 115 matching files: 15 removed whole (1,474 source lines, 1,475 test
lines, 6 figures), 62 edited, 1 left to FIX-1792 (`mailboxes.md`), 37 unrelated. The control:
**CONTROL PASS**, the prose-only plant refused. With `talk.ts` moved aside, the run still passes
and reports one file deleted; the first version threw `ENOENT` there.

The first run, on identifiers only, found 53 files and caught `cas-retry.ts`, which the hand list
had missed. Matching prose too (spec review round 1) found the sixth room figure
(`project-room-sessions.svg`), the glossary and its figures, the Workforce overview, both Shift
Manager READMEs, and three DevTeam files the identifiers missed: `resources/projects.ts`, which
declares `talk:` and so would stop the DevTeam lab loading once BR-31 refuses it, the EM's
room-answer action in `em.mts`, and the room door in `notify.mts`.

The epic's "about 2,200 lines out" was an estimate; the whole-file removals are about 1,500 source
lines, with the room branches of the mailbox flow, the DevTeam room parts and the room parts of
the Shift Manager project view on top. Claims are not removed here
([decided, not asked](../../DECISIONS.md#decided-not-asked)).
