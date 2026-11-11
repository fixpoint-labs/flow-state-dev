# POC · what only a kit removes from claude-code-style's adapter

Retained design evidence for [FIX-2626](../../SPEC.md), not production code. Throwaway, and
outside every default test and build discovery (an `.mjs` file under `specs/`).

**Question.** The epic's [O1](../../../../epics/FIX-2618/DECISIONS.md#o1) rests on the kit's
client half: "a better install API removes the wiring, never the read model". FIX-2622 showed the
install half removes nothing a better API can't. Its implementer note asks this spec to show, on
a real app and before the slot contract is built, what only a kit's client half removes.

**Run** (from the repository root; no install needed, about a second):

```bash
node specs/issues/FIX-2626/poc/client-half/attribute.mjs             # the table
node specs/issues/FIX-2626/poc/client-half/attribute.mjs --controls  # the three red paths
```

## How it attributes

It reads `labs/claude-code-style/src/adapter.ts` at `main` `f0b34c529` (1,642 lines) and finds
every declaration: each top-level type, constant and function, each helper inside
`createWiredLab`, and each verb that function returns. Every declaration owns the doc comment
above it and every line down to the next declaration; the import header counts as *stays*. Each
is credited to the one thing that removes it, under these rules:

| Credit | It goes when… |
|---|---|
| **views** | the live read and views land (FIX-2551, FIX-2623): watch loops, re-reads on notices, and rows one package can compute on the server |
| **direct** | direct reads and writes by scope land (FIX-2624): the own-session helpers and what reads or writes through them |
| **package** | one package ships a constant, a call or a view, with no kit, because it already depends on every input (harness-manager depends on orchestration, so it can serve a coding board over orchestration's board) |
| **kit** | only a kit's slot can: the data joins two packages where neither depends on the other (workforce and harness-manager), so no single package can serve it |
| **stays** | nothing removes it: the app's own screen logic, its thin calls, and the transcript, which keeps its session address under the epic |

The rule for *kit* is strict on purpose. It is FIX-2622's anti-game rule turned on the client:
a line a package view removes is not a line only a kit removes.

## Result

```
labs/claude-code-style/src/adapter.ts at f0b34c529: 1642 lines, 124 declarations, every one classified
  views      630  38.4%
  direct      60  3.7%
  package    117  7.1%
  kit         12  0.7%
  stays      823  50.1%
  kit rows: harnesses 2, harnessOf 10
```

**Only 12 lines need a kit:** the harness a coding task shows before its run reports one, which
joins workforce's worker setting to harness-manager's run. Credit every *package* row to the kit
as well and the ceiling is 129 lines (7.9%). The adapter's read model goes with views and direct
reads (690 lines), which packages can ship without a kit.

The *stays* share is conservative: the transcript code (`watchThread`, `watchTaskWork`,
`entriesOf`, the item followers) is counted as staying because the epic keeps the transcript on
its session address. FIX-2628 measures what really goes. The *kit* figure does not depend on
that split.

## The controls

1. **A planted declaration** (`const planted = 1;` inside `createWiredLab`) stops the table:
   `unclassified: lab:planted`. No declaration can pass uncounted.
2. **A stale row** (a row naming a helper the file doesn't have) stops it too, so the table can't
   rot while the file changes.
3. **The kit row could have come out otherwise.** Reclassifying `boardOf` as *kit* moves the kit
   total from 12 to 42, by exactly its 30 lines.

## What it does not cover

Teammates' adapter (1,935 lines) and Shift Manager's `reads.ts` (1,115) are not attributed:
moving them is a follow-up epic. React is not here either: `@flow-state-dev/react/workforce`'s
panels take rows the app assembles, so no app imports them; a view-bound panel needs views, and
a package can ship it without a kit.
