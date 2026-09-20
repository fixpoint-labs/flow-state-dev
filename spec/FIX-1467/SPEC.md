# FIX-1467 · Explore: split RO `references/` from mutable seed-then-evolve `resources/`

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Exploration · `workforce` · medium · 1 PR · epic [FIX-1457](https://linear.app/fixpoint-labs/issue/FIX-1457) (W5)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **keeps the company handbook in git and edits it there** | The edit reaches the agents on the next deploy — until anything writes that document once. From then on the file is dead weight and the agents read a body that exists in no repo. Nothing reports it | The file in git is the only copy. Editing it *is* the edit, every read, forever |
| **runs an engineering seat that needs the team handbook** | Reachable only because the app remembered to install that team's slice on this seat's kind. Nothing derives it from where the file sits | Reachable because the file sits in that team's folder. No install list to keep in step |
| **runs a sales seat in the same org** | Reads the **engineering** handbook too, unless the app also remembered a filter line. Nobody is told | Cannot. The wall comes from the path, and the app writes no filter |
| **wants an agent to keep notes that survive the turn** | Same folder, same word, same behaviour as the handbook. Nothing on disk tells the two apart | Puts it in `resources/`, which keeps today's database path and still needs a named grant |
| **expects the handbook on the agent's bash mount** | It is not there. Bash mounts collections; a document is a single resource and is skipped | **Still not there.** This exploration does not claim the mount — see *What stays as it is* |

Handbooks are the first thing anyone puts in a workforce tree, and the last thing anyone
checks. The failure is quiet in both directions: a document silently stops being the file,
and a seat silently reads a neighbour's.

## What changes

![Today a markdown file under resources slash seeds one org-wide database row on first boot, every seat reads and writes it across the team wall, and the file goes stale; after, references slash is served from disk on every read and stops at the team wall, while resources slash keeps the database path behind an explicit grant](figures/read-path.svg)

The top row is today, and the red dashed arrow is the part nobody sees: the disk file
stops being the source the first time anything writes. The bottom row splits one folder
into two paths — read-from-disk with a derived wall, and seed-then-evolve with a grant.

**What an author writes, in the tree:**

```diff
  workforce/
    org/
-     resources/handbook.md          # read by agents, writable, seeds a row once
+     references/handbook.md         # read by agents, no write path, read from disk
    teams/engineering/
-     resources/handbook.md
+     references/handbook.md
+     resources/scratch.md           # stays: seeds a row, then the row is the source
```

**And in a `WORKER.md`, for the seat that wants less than its scope gives it:**

```diff
  flow: desk
  description: Engineering desk
+ # Absent entirely = every reference at or above this seat's place in the tree.
+ # Present = a narrowing, never a widening.
+ references:
+   - teams/engineering/handbook
  resources:
    - teams/engineering/scratch: rw
```

## What stays as it is

- **The `resources:` grant that shipped in [#1943](https://github.com/fixpoint-labs/flow-state-dev/pull/1943).** It is right for mutable
  resources and this changes none of it: bare ref is `ro`, `rw` is the extra word, a grant
  narrows and never widens.
- **Skill package-local `references/`.** Same meaning, different tree, untouched. No shared loader.
- **The L1 substrate.** No References type. A reference is still a file entry underneath.
- **The bash and sandbox mount.** References are on **no** mount today, so putting them
  there is net-new work, not a rename — it belongs with [FIX-1382](https://linear.app/fixpoint-labs/issue/FIX-1382), and this spec
  deliberately leaves it there rather than quietly absorbing it.
- **Templates under `resources/`.** They keep seeding as they do now; see
  [Decisions → Carried open](DECISIONS.md#carried-open).

## Sign off

1. **[D1](DECISIONS.md#d1) · A reference is a read path, not a renamed folder.** `references/`
   is served from disk on every read and has no write path; `resources/` keeps today's
   seed-then-evolve behaviour. *If wrong:* org knowledge can only be changed by a deploy, and
   anyone who wanted in-product editing has to move the file and re-teach their people.
2. **[D2](DECISIONS.md#d2) · The tree scope becomes derived and enforced, replacing the app's
   hand-written install filter.** *If wrong:* where a file sits becomes a permission, so moving
   one between team folders silently changes who can read it.

**One open fork — [ambient reach](DECISIONS.md#open): always-on, or an opt-out switch?** It is
the one to weigh; the full ask is on the decisions page. D1 is the one that changes the most
for the most people.

Three further questions the issue left open are **carried open, not put to you** — they cannot
be decided until this direction is: see [Carried open](DECISIONS.md#carried-open).
