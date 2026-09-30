# FIX-1428 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. A refactor's rules are mostly *what must not change*; the
*proved by* column says which check holds each one.

## The shared list

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Any caller asks whether `con`, `prn`, `aux`, `nul`, `com1`–`com9` or `lpt1`–`lpt9` is reserved, in any letter case | Yes | New contracts unit test (all 22, plus mixed case) |
| BR-2 | A caller asks about `com0`, `lpt0`, `com10`, `lpt`, `console`, `con.md` or `""` | No. Whole-name match only; `0` and two-digit numbers are ordinary names on Windows | New contracts unit test |
| BR-3 | The package is imported by a browser bundle | Nothing new is pulled in: the list is pure data with no imports | Existing `contracts-zero-dep.spec.ts` |

## Filesystem store (engine)

| # | When | Then | Proved by |
|---|---|---|---|
| BR-4 | A resource key segment, or a scope id, is a reserved name in any case | Refused with today's message | Existing `resource-path.test.ts`, filesystem guard conformance (`CON`) |
| BR-5 | A walk meets a reserved-name prefix segment | Returns no records, as today | Existing `resource-path.test.ts` `collectRecords` cases |

## Workforce loader

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | A tree name is `CON`, `Nul` or any non-lowercase device spelling | Refused with today's **lowercase** message, not the device message | New characterization test, green before the move and after |
| BR-7 | A tree name or file basename is `con`, `nul`, `com1` | Refused with today's "reserved device name on Windows" message | Existing `codegen.test.ts` |
| BR-8 | A tree name is `com0` or `lpt0` | Accepted | Existing `codegen.test.ts` |
| BR-9 | A name breaks the length or `_meta` rule | Same message as today; those checks still run first | Existing workforce suites |

## The guard

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | The repository holds exactly the one list | The guard passes | CI step on the PR |
| BR-11 | A new source file spells the list (quoted `prn`, templated `com${…}`, or a `com[1-9]` class) | The guard fails and names the file and the canonical import | Guard fixture test, planted copy |
| BR-12 | A test file spells the list by template or regex class | The guard fails | Guard fixture test, planted copy |
| BR-13 | A test passes one device name as an input (`"PRN"`, `"lpt9"`) | The guard passes: a case is not a list | Guard fixture test |

## Failure taxonomy

Nothing new fails at runtime. Every refusal above already exists and keeps its message. The only
new failure is the CI guard, which is fatal to the build and has no retry.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): one list, all three readers on it, the
guard seen to fail on a planted copy, and every existing engine and workforce test green without
edits to its assertions.
