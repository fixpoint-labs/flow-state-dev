# FIX-1456 · Skill names refuse Windows device names

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

Improvement · `packages/orchestration` · tiny · 1 PR · soft-related to
[FIX-1428](https://linear.app/fixpoint-labs/issue/FIX-1428) (not blocked by it)

## The problem

A skill folder can be called `con`, `nul`, `com1` or any other Windows device name. It loads on
macOS and Linux, and then nobody can check the repository out on Windows. Every other name in
the Workforce file tree already refuses these names through `validateSegment` in
`packages/workforce/src/loader/segments.ts`. Skills go through their own validator,
`validateSkillName` in `packages/orchestration/src/skills/skill-md.ts`, which reserves only
`_meta` and the empty string. The docs say so out loud and list skills as the exception
(`apps/docs/docs/workforce/workers-on-disk.md`, "Names in the tree").

## The goal, and how we'll know it's met

**The whole tree follows one naming rule. A skill called `con` gets the same kind of clear error
that a worker or channel called `con` gets.**

- **Smaller, and rejected:** record skills as exempt. The Architect's fence rules this out, and
  the tree would keep two different rules.
- **Bigger, and not this issue's:** a single shared reserved-name list. That belongs to FIX-1428,
  which has since landed it (#2499). This issue calls that shared list and keeps no copy of its
  own ([E1, amended 2026-09-30](DECISIONS.md#e1)).

**Evidence:** a new `validateSkillName` test throws for all 22 device names and accepts `com0`,
`lpt0` and `console`. It fails on `main` and passes on the fix. The commands are in
[PLAN → Checks](PLAN.md#checks).

## What changes

```diff
 // packages/orchestration/src/skills/skill-md.ts  (shape only)
+import { isWindowsReservedName } from "@flow-state-dev/core/helpers";
 …
   if (RESERVED_NAMES.has(name)) throw …
   if (!NAME_PATTERN.test(name)) throw …   // lowercase-hyphen check, unchanged
+  if (isWindowsReservedName(name)) throw `… is a reserved device name on Windows`
```

The device check runs after the name pattern. The shared helper folds case, so this order is what
keeps `CON` getting the existing "must be lowercase" message.

Every entry point already calls `validateSkillName`: the skills folder read, seeding, refresh,
the library index, the frontmatter `name`, `toSkill`, and the load and run tools. So one check
covers all of them, and each caller keeps its current handling. The folder read reports the bad
name in `errors`, and seeding and refresh skip it with a warning.

The docs drop the paragraph that exempts skill folders, and the skills authoring page states the
rule ([DOCS.md](DOCS.md)).

## What stays as it is

The lowercase-hyphen pattern, the 64-character limit, and `_meta`. The device list itself lives
once, in `@flow-state-dev/contracts/helpers`, and `orchestration` reads it through
`@flow-state-dev/core/helpers`, which it already depends on. Nothing new is imported from
`workforce` or `engine`, because `orchestration` can't depend on `workforce`.

## Sign off

**Approve to merge.** The fence sets the direction: add the check, with no exemption. The one
cost is that a skill already named after a device stops loading. We know of none, and the issue
already accepts that break ([D1](DECISIONS.md#d1)).

**Open: none.**
