# FIX-1394 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

The cases, written as rules. This issue's deliverable is a built comparison, so the rules split
in two: what is **true of the system today** (the constraints every candidate must survive, each
re-derived by a check rather than asserted), and what is **true of the matrix** (what counts as a
variant passing a probe). A human reviews this page; the plan turns it into work.

## What holds today, and therefore binds every candidate

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Any source offers a seat a tool — the app catalog, the seat's own `blocks/` folder, a held skill's `allowed-tools`, a capability's tool grant | Only names in that seat's own `WORKER.md` `tools:` list reach it. Everything else is validated and dropped | `evidence/check-conventions.mjs` · C4 (four assertions, one per enforcement point) |
| BR-2 | A seat declares `tools: []` | It reaches nothing, including through a worker it delegated to | C4-fence |
| BR-3 | A block sits in the seat's own `blocks/` folder and the seat's `tools:` does not name it | It is registered and not callable. Registration is not a grant | C4-blocks |
| BR-4 | An author writes any of the five convention files | The frontmatter is parsed by one shared dialect. The syntax is already common; the semantics are not | C2, C2-skill |
| BR-5 | A file-declared document is authored anywhere in the tree | It installs at flow level and is refused `prefetchMode: "lazy"` — there is no per-block trigger to load it on | C3-resource |
| BR-6 | A skill reaches a seat from more than one of its levels | The name is refused entirely. There is no precedence rule | Existing suite (`read-seat-skills`) |
| BR-7 | A capability declares `controlTools` | They cross the fence, because the seat's own config asked for them and they are never exported | C4-skills (the inverse: catalog grants do not cross) |

**BR-1 is the row to read twice.** It is the constraint [D1](DECISIONS.md#d1) either keeps or
breaks, and every candidate format lives or dies on it. It is asserted at four points rather than
one because four independent pieces of code enforce it, and any one of them relaxing would make a
package able to grant itself capability without the other three noticing.

## What counts as a variant passing a probe

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | A variant is built | It is judged only on the six probes fixed before any variant existed. A probe added mid-matrix is applied to every variant or to none | The matrix's own record (`PLAN.md → Checks`) |
| BR-9 | **P1** · a package carries instructions, attached to a seat | They compose with the seat's own and its team's, in a stated order, with the seat's last. No fourth layer, and the team's text does not merge into the seat's | Goal check on the real path |
| BR-10 | **P2** · a package carries a tool | The tool is registered and callable **only** when the receiving seat's `tools:` names it (D1). A variant that makes it callable without that has failed P5, not passed P2 | Goal check |
| BR-11 | **P3** · a package carries a document | Expected to fail in all four, per BR-5. A variant that passes it has changed resource installation, which is out of this issue's scope and is a finding, not a win | Goal check · the failure is the result |
| BR-12 | **P4** · the same package is attached to a seat and held in a library | Byte-identical contents; the only difference is when it is in context. A variant needing two authored forms has failed | Goal check on both modes |
| BR-13 | **P5** · the grant gate | BR-1, BR-2 and BR-3 still hold with the variant's package attached. A variant that widens the gate fails, whatever else it passes | CI · the C4 assertions re-run against the variant |
| BR-14 | **P6** · an existing workforce tree | Loads and hires unchanged, with today's five conventions present and no package authored | CI · existing workforce suite, unmodified |
| BR-15 | Every variant fails a probe the others pass, or passes none the others fail | The result is *don't collapse*, recorded with the same force as any other. It is not a failed matrix | The ratify |

## Failure taxonomy

Nothing in this issue runs in production, so there is no runtime failure class. The failure modes
that matter are the matrix's: a probe applied unevenly (BR-8) makes the comparison unreadable, and
a probe the set omits becomes a gap the ratify silently inherits. Both are caught by fixing the
set before building and by recording each variant's result against every probe, including the ones
it was not built for.

**One check can go stale rather than fail**: `evidence/check-conventions.mjs` asserts a count of
five convention readers and that every reader on disk is one the spec classified. A sixth
convention landing turns the count red rather than passing quietly, and the negative control
(`--negative-control`) plants exactly that and confirms it goes red.

## Acceptance criteria this issue owns

Four variants are built against the same six probes, every cell is recorded — including expected
failures and probes a variant was not built for — and one answer is ratified and written to the
epic-spec's ER-2, where the siblings read it. *Don't collapse* is a passing outcome. **No format
ships and no file changes under `packages/` from this issue**; ship tickets, if any, are cut after
the ratify ([ER-8](https://github.com/fixpoint-labs/flow-state-dev/pull/1905)).
