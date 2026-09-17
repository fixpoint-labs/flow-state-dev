# FIX-1389 · One tree-walk, four readers

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Feature · `workforce` · small · 1 PR · epic [FIX-1351](https://github.com/fixpoint-labs/flow-state-dev/pull/1718)

## Four people, before and after

| Someone who… | Today | After |
|---|---|---|
| **points a workforce root at a symlink** | Two of the four readers follow it and load a team from wherever it points. The other two refuse. Same tree, two answers, and every reader's own header promises the refusal | All four refuse it, in the wording the two already use |
| **adds the next thing the tree can hold** | Copies about thirty lines of team-walk out of whichever sibling reader looks closest, and hopes it still agrees | Calls the shared walk and writes only the part that is genuinely theirs |
| **fixes how a broken team folder is reported** | Fixes it in one reader. The other two keep the bug until somebody notices | Fixes it once, for all three |
| **sorts a reader's failures by what went wrong** | Three readers tag every failure with which condition it was. The worker reader does not, so its callers match on the error text | Every reader tags every failure |

**Why now.** Three conventions shipped in five weeks, each walking the same tree. The walk's
lower half was extracted as they went — classifying a path, opening a structural folder, the
symlink and unreadable wordings — and the upper half was not. So the same `teams/` loop exists
three times, the same ignore list exists three times, and the root is opened four times in four
places, two of which forgot the symlink check. Two more conventions are specced and waiting
([FIX-1368](https://linear.app/fixpoint-labs/issue/FIX-1368),
[FIX-1388](https://linear.app/fixpoint-labs/issue/FIX-1388)); each one copied again is another
place for the contracts to drift.

## What changes

![Two aligned grids, five levels of the workforce tree by four readers. Today the root level and the team-folder level are a separate copy in each reader that walks them; the teams and slot levels already come from one shared primitive; each reader's leaf loop is its own on purpose. After, the root and team-folder rows become one shared primitive too, the leaf row is untouched, and the skills reader stays absent from the team rows because it never enumerates teams.](figures/who-walks-what.svg)

Read the rows. Two of the five already come from one place, and two do not — those two are the
whole change. The bottom row stays four separate cells on purpose: what a reader does *inside* a
team is where the conventions are supposed to differ, and flattening that is the mega-reader the
epic already refused ([ER-10](https://github.com/fixpoint-labs/flow-state-dev/pull/1718)). The
skills column is mostly empty because that reader never enumerates teams at all — it jumps
straight to three known folders ([D1](DECISIONS.md#d1)).

**What the next convention's author writes instead of copying:**

```diff
- const IGNORED_ENTRIES = new Set([".DS_Store", "Thumbs.db"]);
- try { await fs.readdir(root); } catch (err) { throw new Error(`Failed to read …`); }
- const teams = await openStructuralDirectory(path.join(root, "teams"), "teams");
- for (const teamId of teams.entries) { /* ~25 lines of classify-and-report */ }
+ await openRoot(root);
+ for await (const team of forEachTeam(root, report)) {
+   // only the part that is actually this convention's
+ }
```

## What stays as it is

- **Every reader's public shape.** Same functions, same arguments, same result fields, same
  error text, same walk order. One behaviour changes and it is named below.
- **The leaf loops.** A worker and a channel are folders; a document is a file; a directory in a
  documents folder is an error rather than a skip. Those disagreements are decisions each
  convention made, and none is touched.
- **The channels reader's team-only scope.** Widening it to `org/` is somebody else's call and
  deliberately unowned ([Open 5](https://github.com/fixpoint-labs/flow-state-dev/pull/1718)).
- **The skills reader outside the root.** It keeps its own level list, its ancestor-symlink
  check and its duplicate-name refusal.
- **The older skills-folder reader in `orchestration`.** It has a fourth copy of the ignore list.
  It sits *below* this package, so it cannot reach these primitives without inverting the
  dependency. Named, not fixed ([Considered and dropped](DECISIONS.md#considered-and-dropped)).

## Sign off

1. **[D1](DECISIONS.md#d1) · The shared piece stops at the team folder — it enumerates teams, it
   does not read slots.** If wrong: the next two conventions each hand-roll the team loop again,
   and we have bought three copies' worth of churn for nothing.
2. **[D2](DECISIONS.md#d2) · The symlinked-root refusal lands here, and
   [FIX-1375](https://linear.app/fixpoint-labs/issue/FIX-1375) closes with it.** If wrong: an
   operator who has a symlinked root today gets a thrown error where they used to get a loaded
   roster — the one behaviour this change alters.

**Open: none.** Number 2 is the one to weigh: it is the only line that is not pure movement. What
was rejected and why: [DECISIONS.md](DECISIONS.md). The cases, and what proves each:
[BUSINESS-RULES.md](BUSINESS-RULES.md).
