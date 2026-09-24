# A caller's own `agent` wins every seat

A team that does not want our stock worker registers their own flow under `agent`, and theirs runs
every seat on the roster — including the records that never mention a kind at all.

## The contract

Three worker records, one call, the app's own `agent` passed in `kinds`:

(a) **Every** seat resolves to the caller's flow, not just the first. Graded per seat by reading
each seat's own settings bag — `desk` is a setting only the caller's flow declares, and `model` is
one only the built-in declares. Two records leave `flow:` out entirely and one writes `flow: agent`;
both shapes must land on the caller's flow.

(b) Those seats **register**, through the real flow registry.

(c) One seat runs to completion over the real HTTP route, and its own record's body is read back at
the far end as that seat's `instructions`, from a block nested inside the action.

(d) **The control run.** The same roster with the replacement declared a *singleton* — no
`cardinality: "collection"` — mints all three seats and is refused at **registration**. This is the
leg that gives the others their meaning: the mint is not the gate, so a check that stopped at the
hire would pass while every seat was still broken.

## Why it is shaped this way

Counting instances is the trap. Asserting that three seats came back passes even when all three are
ours, so the check reads each seat's identity through its own bag instead.

Registration is the second trap. A replacement declared the ordinary way is a singleton whose seats
mint perfectly well and are then refused one by one when they are registered, which is why the
contract requires `cardinality: "collection"` and why this check carries a control run that must
fail there.

No model runs. What is graded is which flow answered and which settings reached it, so the seats run
on handlers.

**Model:** n/a — handlers only. The property under test is which flow answered and which settings reached it, not model output.

## Runs

| Date | Branch | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-13 | fix/fix-1363 | n/a | PASS | All three seats resolved to the caller's flow (1 naming the kind, 2 naming none), registered, and one ran end to end with its own body arriving as `instructions`. The control run minted three seats and was refused at registration. |
| 2026-09-13 | fix/fix-1363 (control: built-in merged *over* the caller's kinds) | n/a | FAIL (expected) | With the precedence inverted, all three records hired into the built-in and were refused at the mint — `Flow "agent" instance "engineering.lead" has an invalid config bag: "desk" is not a declared setting`. Pins that the check is sensitive to the merge order, which is the one line acceptance criterion 4 rests on. |
