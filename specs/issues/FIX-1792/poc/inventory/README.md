# Checker · what converting `MAILBOX.md` touches

The factual base of [FIX-1792](../../SPEC.md), re-derived by a script rather than counted by hand.
Not production code; outside default discovery ([specs/README.md](../../../../README.md)).

## How to run it

```bash
node specs/issues/FIX-1792/poc/inventory/check.mjs            # the census and the inventory
node specs/issues/FIX-1792/poc/inventory/check.mjs --control  # must print CONTROL PASS
node specs/issues/FIX-1792/poc/inventory/check.mjs --after    # the end state; FAILS until P4 lands
```

**The census** parses every tracked `MAILBOX.md`, asserts the counts the spec states, and requires
each file to have a row with its target and what its goal or app uses it for. A file with no row
fails the run, and so does a board list that differs from its row.

**The inventory** lists every tracked file outside retained specs, internal docs and changesets
that names the removed surface by identifier, and every goal unit that names it or says "mailbox"
at all, and asserts **totality**: each one is classified. A goal is matched on the word because it
stops running when the mailbox flow goes, whatever it calls it. Package source and docs that say
"mailbox" without naming the removed surface are FIX-1796's sweep, not this one's.

**The removal inventory** is `REMOVED_EXPORTS`: every exported name the conversion removes. The
census keeps it total. Every export a removed package-source file declares, and every
mailbox- or claim-named export in package source, is listed as removed or as kept with a reason
(`KEPT_EXPORTS`: generic names, the seats inventory, what FIX-1791 extracts or FIX-1793 removes).
The pre-rename module's exports are on it too: its refusal goes by D2's answer.
The inventory scan matches these names as well as the surface patterns.

`--after` is the implementation's check. No `MAILBOX.md` is left, no file names a
`REMOVED_EXPORTS` name, and `MANIFEST_DOMAINS` no longer lists `mailboxes`. Nothing is exempt:
no refusal of an old shape survives ([D2](../../DECISIONS.md#d2)).

`--control` plants an unclassified source file that imports `openMailboxes`, a goal that says
"mailbox" only in prose, and an unlisted mailbox-named export. The census must fail on all three.
Then `--after` must fail on a plant that names `MAILBOX_ROUTE_COMPONENT`, `emitMailboxPostLine`,
`MAILBOX_KIND` and `mailboxKinds`, on a planted `MAILBOX.md` left in a tree, and on
`MANIFEST_DOMAINS` as it is today. The
plants are removed afterwards. The listing includes untracked files so the plants are seen without
staging them.

## What was observed

On `cad4e2780` (`main`, 2026-10-06): **PASS**. Re-run after review round 1, on `main` at
`ce06cb5c7` merged into the spec branch: **PASS**, **CONTROL PASS**, `--after` **FAIL** (173).
Re-run after the sign-off fold (2026-10-07), on the spec branch and on `main` at `a959b64fb`:
**PASS**, **CONTROL PASS**, `--after` **FAIL** (209). The numbers below are that run's.

- **33** `MAILBOX.md` files, **15** with `boards:`, **16** boards (one file declares two),
  **3** with `boardActions:`, **0** with `mintFor:`, **2** with `flow:` (both `digest`, a kind of
  the tree's own), **2** with `routing:`, **2** with an empty `members:` list. The issue's 33 and
  15 hold; the epic's "15 boards" counts files, not boards.
- Targets (after the product owner's answers of 2026-10-06 and 2026-10-07): **11** coordinators
  whose board becomes a session board (the conversation's, or the filing worker's own), **2** files
  that become Storefront workstreams the EM leads (the DevTeam's `feature` and `release`), **15**
  coordinators with no board (kitchen-sink's help desk among them, its `escalations` board removed
  with the feature), **5** removed with the goal or legs they served: the pre-rename goal's two,
  manager-queue-lab's two board-in-a-seat-folder trees, and `mailbox-boards`'s `notices`. No old
  file is kept.
- **197** files outside `goals/` name the surface: 40 removed whole, 97 edited, 47 converted,
  8 are FIX-1793's, 4 are FIX-1796's, 1 unrelated; none carries a refusal. The whole-file removals
  are about 5,500 source lines, 8,200 test lines and 1,200 lines of docs and figures. Kitchen-sink's
  `escalate` tool, its test and its `no-filing` control are among them: the escalation feature is
  removed, not replaced. Round 1 added seven: matching the full export list found files the
  surface patterns had missed.
- **Exports:** 107 names removed (the pre-rename module's ten among them), 27 kept with a reason;
  every export of a removed file is one or the other.
- **49** goal units: 26 convert, 13 rewrite an outcome the epic or the product owner changes,
  6 edit a field or a word, 1 is FIX-1793's, and 3 retire.
- **The control:** CONTROL PASS, all six cases caught, and nothing left behind.
- **`--after` on today's `main`:** FAIL, 209 problems (173 before the sign-off fold, 130 before
  round 1), one of them
  discovery's pinned domain list still naming `mailboxes`. That is the red
  state; it shows the end-state check reaches the code it covers.

The census found two things no hand count had: the board count is 16, not 15, and the two `flow:`
files name a kind of the tree's own, not the coordinator, so "`flow:` unchanged" in the concept's
table cannot apply to them ([DECISIONS.md](../../DECISIONS.md#decided-not-asked)).
Both go with the goals they served.
