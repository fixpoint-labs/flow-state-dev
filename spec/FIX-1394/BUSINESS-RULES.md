# FIX-1394 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

The cases, written as rules. This issue's deliverable is a built comparison, so the rules split
in two: what is **true of the system today** (the constraints every candidate must survive, each
re-derived by a check rather than asserted), and what is **true of the matrix** (what counts as a
variant passing a probe). A human reviews this page; the plan turns it into work.

## What holds today, and therefore binds every candidate

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Any source offers a seat a tool — the app catalog, the seat's own `blocks/` folder, a held skill's `allowed-tools`, a capability's tool grant | Only names in that seat's own `WORKER.md` `tools:` list reach it. Everything else is validated and dropped | `evidence/check-conventions.mjs` · C4, anchored on four behavioural suites, one per enforcement point |
| BR-2 | A seat declares `tools: []` | It reaches nothing, including through a worker it delegated to | C4-delegation · C4-capability |
| BR-3 | A block sits in the seat's own `blocks/` folder and the seat's `tools:` does not name it | It is registered and not callable. Registration is what a folder does; granting use is the seat's `tools:` line | C4-blocks |
| BR-4 | An author writes a convention file | There are **seven** conventions across three doors. Door A's five are Markdown and share one frontmatter dialect; Doors B and C are TypeScript modules (`resources/*.ts`, `blocks/*.ts`) and share none of it | C1, C1-total, C2, C2-typescript |
| BR-5 | A single resource is declared at **flow** level with `prefetchMode: "lazy"` | Refused — a flow-level declaration has no per-block load trigger. **The refusal's own message names the remedy**: declare it on the block that needs it. Lazy *is* available at block level, so an opt-in document is a design problem, not an impossibility | C3-lazy-scope · C3-lazy-remedy |
| BR-6 | A package travels opt-in and wants to carry a document | A skill folder already carries supporting files beside its `SKILL.md`. One opt-in-attachable unit that ships a document therefore already exists | C3-skill-files |
| BR-7 | A skill reaches a seat from more than one of its levels | The name is refused entirely. There is no precedence rule | Existing suite (`read-seat-skills`) |
| BR-8 | A capability declares `controlTools` | They cross the fence, because the block composing the capability *is* the declaration and a control is built inside it and never exported | C4-controls |

**BR-1 is the row to read twice.** It is the constraint [D1](DECISIONS.md#d1) either keeps or
breaks, and every candidate format lives or dies on it. Round 1 caught its check proving only that
implementation identifiers were present; it now anchors on the four behavioural suites that
exercise each tool source against a restricted seat, including the capability-side fence in
`packages/core/src/blocks/generator.ts` that the first version did not reach at all.

**BR-5 and BR-6 replace a claim this spec got wrong.** The draft said a document had no opt-in mode
anywhere. The restriction is narrower, and two ways to satisfy the opt-in half already exist.

## What counts as a variant passing a probe

| # | When | Then | Proved by |
|---|---|---|---|
| BR-9 | A variant is built | It is judged only on the six probes fixed before any variant existed. A probe added mid-matrix is applied to every variant or to none | The matrix's own record (`PLAN.md → Checks`) |
| BR-10 | **P1** · a package carries instructions, attached to a seat | Its text reaches the prompt through the framework's existing prompt slot, in a position the variant states and holds. The slot is an array that drops absent entries, so **adding an entry is not a contract change**; what a variant may not do is reorder, displace or add a second way to configure the reserved `default` layer, or merge the team's text into the seat's | Goal check on the real path |
| BR-11 | **P2** · a package carries a tool | The tool is registered and callable **only** when the receiving seat's `tools:` names it (D1). A variant that makes it callable without that has failed P5, not passed P2 | Goal check |
| BR-12 | **P3** · a package carries a document | Attached always-on, the document is installed and readable. Held opt-in, it arrives when the package activates and not before. A variant may reach the opt-in half through block-level lazy declaration (BR-5) or through the bundled-files path a skill already uses (BR-6) — **the probe states the behaviour and does not prescribe the mechanism** | Goal check, both modes |
| BR-13 | **P4** · the same package is attached to a seat and held in a library | Byte-identical contents; the only difference is when it is in context. A variant needing two authored forms has failed | Goal check on both modes |
| BR-14 | **P5** · the grant gate | BR-1, BR-2 and BR-3 still hold with the variant's package attached. A variant that widens the gate fails, whatever else it passes | The four grant-gate suites, run against the variant's fixture tree |
| BR-15 | **P6** · an existing workforce tree | Loads and hires unchanged, with today's seven conventions present and no package authored | The existing workforce suite, once per matrix |
| BR-16 | Every variant fails a probe the others pass, or passes none the others fail | The result is *don't collapse*, recorded with the same force as any other. It is not a failed matrix | The ratify |

**Every probe is satisfiable.** Round 1 caught P3 written so that no candidate could pass and a
candidate that did pass would be rejected — a probe that distinguishes nothing, and one that would
have let the matrix ratify a format unable to carry documents in both modes. BR-12 now states an
observable behaviour and leaves the mechanism to the candidates. BR-10 was rewritten for the same
reason: as drafted it forbade a fourth prompt layer, which every package-bearing variant would
need once the reserved `default` lands.

## Matrix failure modes

Nothing here runs in production, so there is no runtime failure class. The failure modes that
matter are the matrix's: a probe applied unevenly (BR-9) makes the comparison unreadable, a probe
the set omits becomes a gap the ratify inherits, and a probe no candidate can pass (the P3 defect
above) consumes a column while distinguishing nothing. All three are caught by fixing the set
first, checking each probe is satisfiable by *something* before building, and recording every
variant's result against every probe.

**One check can go stale rather than fail**: `evidence/check-conventions.mjs` asserts seven
convention readers and that every reader on disk is one the spec classified. An eighth landing
turns it red rather than passing quietly, and `--negative-control` plants one in Door C — the door
round 1 found missing — and confirms it goes red. C4 without `--run-tests` asserts that the four
grant-gate suites and their named cases still exist; that catches a deleted or renamed test but not
one that has stopped proving what its name says, which is why `--run-tests` is required before the
ratify.

## Acceptance criteria this issue owns

Four variants are built against the same six probes, every cell is recorded — including expected
failures and probes a variant was not built for — and one answer is ratified and written to the
epic-spec's ER-2, where the siblings read it. *Don't collapse* is a passing outcome. **No format
ships and no file changes under `packages/` from this issue**; ship tickets, if any, are cut after
the ratify ([ER-8](https://github.com/fixpoint-labs/flow-state-dev/pull/1905)).
