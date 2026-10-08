# FIX-1811 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. Each says what an author or the system does and what happens. The
*proved by* column is the check the plan runs.

## What the model sees

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A generator's `tools` holds `block.as({ name: "B", description: "d" })` | The model is offered a tool `B` described as `d`, with the original's input schema | CI · goal leg a |
| BR-2 | `.as({ description })` with no name | Name unchanged, description replaced | CI |
| BR-3 | `.as({ name })` with no description | The original's description is kept | CI |
| BR-4 | Two `.as()` copies of one block, different names, in one tool list | Two tools; each call runs the block once, attributed to the name the model called | CI |
| BR-5 | A copy whose name equals another tool's in the same list | Refused as duplicate tool names are today | CI |
| BR-6 | `.as({ name: "" })` or a whitespace name | Refused at build, as a blank-named block is | CI |

## One name, everywhere

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | A renamed copy runs, of any of the five block kinds | Every item, trace row, status line, tool observer call and error it produces names the new name; none names the original | CI totality check over all five kinds · goal leg a |
| BR-8 | The original block is used beside its copy, in the same flow | The original keeps its name in every item and trace; the two never share a trace row | CI |
| BR-9 | A renamed tool suspends for approval, then the person approves | It resumes under the new name and its side effect happens exactly once | CI · goal leg a |
| BR-10 | A renamed tool suspends, then the person denies | The denial reaches the model as for any tool, under the new name | CI |
| BR-11 | A renamed copy holds block state, or is a router whose branch suspends | State and the route decision are kept under the copy's own path, as for a block authored with that name | CI |
| BR-12 | `ctx.wasRescued(...)`, a router's route lookup, or any other lookup by block | Matches the copy by its new name; passing the original does not match the copy | CI |

## Composing with what the block already has

| # | When | Then | Proved by |
|---|---|---|---|
| BR-13 | The original carries connectors, a model-output mapper, rescue handlers, declared resources, capabilities, a dispatch address, flow-config requirements or (a sequencer) a reported output schema | The copy carries all of them unchanged; resources and flow config still reach the flow through it | CI, one assertion per property |
| BR-14 | `.as()` is chained with `.connectInput()`, `.mapModelOutput()` or `.rescue()`, in either order | Same result either way | CI |
| BR-15 | `block.as({ name: "B" }).asTool()` in a sequencer step | The tool pill is named `B` | CI |
| BR-16 | `block.asTool().as({ name: "B" })` | The wrapper's trace row is `B`; the pill keeps the original name. Documented, not refused | CI |

## Workforce's catalog

| # | When | Then | Proved by |
|---|---|---|---|
| BR-17 | A catalog entry `hire: x.as({ name: "hire" })`, where `x`'s own name is different (Workforce's hire block; likewise `setWorkstreams: projects.setWorkstreams.as({ name: "setWorkstreams" })`) | Passes the key-equals-name check **under the new name** at startup, and a worker whose `tools:` names `hire` is offered it, with the new description. This is the drop-in FIX-1812 relies on | CI in workforce, on Workforce's real hire block · goal leg b |
| BR-18 | A catalog entry whose key differs from the `.as()` name | Refused at startup with today's message, naming both spellings | CI in workforce |
| BR-19 | A worker's own folder or a held package registers a renamed copy | Same one-name check, reading the new name | Existing suite, unchanged code |
| BR-20 | A capability and the app's catalog both give one key, one of them an `.as()` copy | Refused as two different tools under one key, as today. Reuse one copy value in both places to share it | CI in workforce |

## Failure taxonomy

Every refusal is at build or at startup, never mid-run: a blank name at `.as()`, a duplicate tool
name when the generator assembles its tools, a catalog mismatch when the agent flow is defined.
Nothing new is caught at run time and nothing retries.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): both legs of
`goals/block-as/presents-a-block-under-a-new-name/` PASS on a real model, after both FAILED under
`GOAL_CONTROL=no-as`. The BR-7 totality check passes over all five kinds and fails on its planted
control.
