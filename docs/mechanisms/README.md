# Mechanism map

The inventory of framework mechanisms. One entry per mechanism a spec would name. [`map.yaml`](map.yaml) is the source the checker reads. This page is how to read it.

[`architecture-reference.md`](../contributing/architecture-reference.md) stays the locked-contract cheat sheet. This map does not restate those contracts. It cites them. The two files point at each other so a reader does not have to guess which one is current.

The rule for when a new mechanism is allowed is [Compose existing pieces](../contributing/orchestration.md#compose-existing-pieces). This page does not repeat it.

## What an entry is

An entry is a mechanism: a named thing a spec's "builds on" or "adds" row would point at. A block, a flow, a task board, the goal-seek loop, a store.

A **facet** is a piece inside that mechanism. The five block kinds are facets of `block`. The twelve utility factories are facets of `utility-block`. `parallelTasks` and `planAndExecute` are facets of `goal-seek-loop`, because they are recipes on that loop. The four notice records on a task row are facets of `task`, because they are four jobs inside one mechanism.

An adapter of one seam is a facet, not a second mechanism. Memory, filesystem, SQLite, Postgres, and Vercel Postgres are facets of `store`. Node, Next, Vercel, and Lambda are facets of `host`. Claude Code, Codex, and Cursor are facets of `coding-harness`.

An app is not an entry. `reliedOnBy` names a directory that uses the mechanism.

`status` is `canonical`, `deprecated`, or `candidate-to-merge`. Nothing in this draft is `candidate-to-merge`. A near-duplicate stays `canonical` with an `overlaps` note until someone decides to merge it. `deprecated` requires `mergeInto`. The one legacy surface that the code already calls legacy, `createSkillsCapability`, is `deprecatedExports` on `skills`, not a second entry.

`overlaps.relation` is one of `near-duplicate`, `distinct-jobs`, `adapters`, `legacy`, `missing-abstraction`. An overlap is stored on one entry. Search the file for the other id before you conclude it has none.

## How the skills read it

This file is an inventory. It does not return a verdict.

- **reuse-review** still decides reuse, extend, or genuinely new. Resolve a name to an entry id or `entry.facet` before searching. Facets of one entry are the records to compare. The notice facets are the worked example of four names that are not synonyms. `missing-abstraction` means a shared noun was decided and is not in the code yet. `holds[]` is that case: it is not an entry.
- **analysis** still takes its reuse answer from reuse-review. It does not search the tree itself, and it does not search this file instead.
- **audit-coherence** is still the whole-codebase duplicate sweep. Its per-job surface map (every method that does one job, and whether to keep, fold, or retire it) is still that skill's output. Use this inventory to see which mechanisms that job already touches. Do not paste this file in as the surface map.
- **improve-codebase-architecture** can read `builtOn` and `overlaps` before proposing a new abstraction that already has an entry.

The skills are not edited in this draft. A one-line pointer belongs there only after the format is accepted.

## What the checker does

`node scripts/validate-mechanism-map.mjs`, or `pnpm mechanism-map`. It is not part of `pnpm typecheck` and it does not fail CI.

It fails when:

- a path, export, subpath, `builtOn`, `overlaps`, or `mergeInto` does not resolve
- a concrete `package.json` export subpath has no entry
- a public value export that looks like a primitive is not named by any entry
- a function-shaped export of a file an entry `covers` is not named (this is how a new utility factory is caught)
- a spec's `mechanisms` fence names an unknown id, or an `adds` row has no `considered` list and no `because`

A spec with no fence is a warning. `--strict` makes that an error. The prose tables in today's specs are not parsed. They do not share one shape.

```bash
node scripts/validate-mechanism-map.mjs --spec path/to/SPEC.md
node scripts/validate-mechanism-map.mjs --spec path/to/SPEC.md --strict
node scripts/validate-mechanism-map.mjs --self-test
```

The fence, when a spec opts in:

```mechanisms
uses:
  - task
extends:
  - task.notice-taken
adds:
  - name: a fifth notice marker
    considered:
      - task.held-ending
      - task.notice-taken
      - task.notice-deferred
      - task.lapsed-slot-backoff
    because: |
      The four records already cover a lapsed wait, a delivery claim, a deferral, and the backoff. Say which one this repeats, or why none of them can.
```

`because` has to be non-empty. The checker does not decide whether it is any good.

## Known gaps

A green run is not a complete map.

- A primitive is claimed by export name, not by package. `generator` on `workforce/fsdev-gen` is the hook `fsdev gen` calls, and `generator` in core is the block kind. `system()` in memory and `system()` in thought-fabric are two functions. Engine's `isRetryableError` is a different function from core's, and engine deliberately does not re-export core's. The checker treats one name as claimed.
- Names that are not `define*`, not `create*Capability|Adapter|Runtime|Stores|Handler|Client`, not a `*Stores` factory, and not in the checker's bare list are not required. A new `readFoo` or `makeFoo` on a public barrel does not fail. Verb-first helpers such as `filterRelevance` are in that gap. The ones this draft knows about are named anyway.
- Wildcard export keys and CSS are warnings.
- `reliedOnBy` is checked only when it contains a slash, and then only that the path exists. It is not an import scan.
- The checker does not decide whether an overlap is real.

## What this draft does not do

It does not mark a merge the code has not already called legacy. It does not add `holds[]` as if the field existed. It does not fix the quick reference where it has drifted from the code (the utility table omits `cascadingRouter`; the sequencer method list is short). Those stay until someone edits them on purpose.
