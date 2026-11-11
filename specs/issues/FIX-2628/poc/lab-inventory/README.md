# POC · the lab's inventory: what FIX-2628 removes, and the kit-only premise

Retained design evidence for [FIX-2628](../../SPEC.md), not production code. Throwaway, and
outside every default test and build discovery (an `.mjs` file under `specs/`).

**Questions.** (1) Does [FIX-2626](../../../FIX-2626/SPEC.md)'s crediting table still hold on
today's `main`: 42 of the adapter's lines need a kit? (2) What does "off workforce's project
concept" cover in this lab, counted, so the implementation can be held to zero? (3) Are the
epic's "today" sizes current?

**Run** (from the repository root; no install needed, about a second):

```bash
node specs/issues/FIX-2628/poc/lab-inventory/check.mjs                  # the tables
node specs/issues/FIX-2628/poc/lab-inventory/check.mjs --controls       # the red paths
POC_EXPECT=gone node specs/issues/FIX-2628/poc/lab-inventory/check.mjs  # the after-state; fails on today's main
```

## Result, on `main` at `aea65f7ba` (2026-11-11)

```
sizes today          adapter.ts 1,642 · host.mts 160 · workforce/flows/ 503 in 5 files
                     (harness-thread 346, dismissals 58, pins 54, projects 32, user-marks 13)
kit-only premise     adapter byte-equal to f0b34c529: true · FIX-2626's table, kit lines: 42
                     harness-manager depends on workforce: false · workforce on harness-manager: false
workforce imports    35 identifiers: project 9 · install 17 · adapter 2 · kept 7
project tokens       setWorkProject 3 · needsProject 1 · listProjects 9 · createProject 10
                     PROJECTS_FLOW 4 · LabProject 11 · projectId 16   (lab code, tests excluded)
```

**(1) Confirmed.** The adapter has not changed since FIX-2626 read it, its table still totals 42
kit-only lines, and the premise under the *kit* credit is true: the two packages the join spans
depend on neither each other. The *kit* credit is still a judgment per row, as FIX-2626 says;
this confirms the table is current and its premise holds, not each row's call.

**(2) Nine project identifiers, one job.** Every one serves the same job: find the repository a
run works in, or let a person pick one. None reads members, project files, MCP servers,
workstreams or a project's checks for a lab screen. `projectChecks` is wired into the coding
flow, but no lab screen writes a project's checks. That is [D1](../../DECISIONS.md#d1)'s *Because*.

**(3) The issue's sizes are stale.** The issue says 1,498 adapter lines, 431 flow lines in three
flows and a 158-line host. Today: 1,642, 503 in five, 160.

## The controls

`--controls` plants into an in-memory copy and requires the named problem each time:

1. An import of an identifier with no fate stops the table (`no fate: definePlanted`).
2. A namespace import and a dynamic import each stop it (`unparsed workforce import`): no form of
   import can pass uncounted. The first run caught a real one, a `vi.mock` of the workforce
   client in a test; it is now named in `NON_IMPORT`, with its count.
3. A sixth file in `workforce/flows/` stops it (`unowned file`).
4. Deleting `projects.mts` stops it (`stale fate row`), so the table can't rot.
5. `POC_EXPECT=gone` fails on today's `main`: 9 project imports, 54 project tokens, the
   adapter, and five files in `workforce/flows/`.
6. A correct after-state passes `POC_EXPECT=gone`: a lab with no adapter, no `workforce/flows/`
   and new kit imports (`workforce`, `useTasks`). In gone mode an identifier with no fate is
   allowed and `NON_IMPORT` counts are maximums; only the project concept, project tokens, the
   adapter and `workforce/flows/` fail it.

## What it does not cover

Whether a file under `src/` assembles server data. No path rule can see that, so this POC
doesn't try. The implementation PR promotes `POC_EXPECT=gone` into the lab's inventory test
(`test/inventory.test.ts`) and adds [FIX-2629 D1](../../../FIX-2629/DECISIONS.md#d1)'s two
content rules to it: no UI file reaches the server itself, and no hand-written type for a row a
view returns. Those rules are the static floor; FIX-2629's browser legs, which read that test,
catch a screen still assembling rows.
