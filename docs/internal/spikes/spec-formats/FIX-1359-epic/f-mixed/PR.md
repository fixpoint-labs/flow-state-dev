# spec(epic): a built-in, replaceable `agent` kind for Workforce (FIX-1359)

| A team that… | Today | After this epic |
|---|---|---|
| **writes a `WORKER.md` with only instructions** | Hire refuses it. They write their own agent, or use a factory we're deleting | The built-in kind. The seat talks and uses its skills. Zero config lines |
| **wants their own shape** | Every kind is theirs anyway | One line, `flow: myCustomAgent`. A typo fails loudly |
| **wants it to remember** | Nothing to attach to | Composes the shipped memory pieces into a kind of their own. A gap is named, not faked |
| **reads the docs** | Taught the factory we're deleting | One way in |

<img src="https://raw.githubusercontent.com/fixpoint-labs/flow-state-dev/0892195d6af5779db4a13d28c5ec054d1905aab4/docs/internal/spikes/spec-formats/FIX-1359-epic/f-mixed/figures/end-state.svg" width="940" alt="What's in the box for a WORKER.md with only instructions, what the app composes in, what one line replaces, and what isn't built" />

**Why now.** The W2 epic is deleting the factory people use today. The replacement has to land first.

**The set:** seven issues in a chain. Recon, a contract, the kind, skills into it, a memory seam onto it, the teaching, and a required proof that hires the thing for real. As of 2026-09-16: 3 done, 3 in flight, 1 not started; the live table and the dependency graph are in [the spec](SPEC.md#the-set--as-of-2026-09-16).

<img src="https://raw.githubusercontent.com/fixpoint-labs/flow-state-dev/0892195d6af5779db4a13d28c5ec054d1905aab4/docs/internal/spikes/spec-formats/FIX-1359-epic/f-mixed/figures/sequence.svg" width="940" alt="The path: one lane per issue against time, done bars for the first three, in-flight bars at the now line, an empty proof lane after them, the critical path drawn through audit, contract, kind and proof" />

The path is redrawn on this PR as the set moves. Only skills and memory ever ran in parallel; the proof waits on both.

<img src="https://raw.githubusercontent.com/fixpoint-labs/flow-state-dev/0892195d6af5779db4a13d28c5ec054d1905aab4/docs/internal/spikes/spec-formats/FIX-1359-epic/f-mixed/figures/ownership.svg" width="940" alt="Who owns what: a matrix of nine cross-cutting rules by seven issues, each rule with exactly one owner" />

Every cross-cutting rule has one owner. A rule with two would be a seam; a rule with none would be a gap.

## Sign off

1. **A stock agent seat is worth seven issues, now.** If wrong: a cycle on a kind nobody hires, which the proof exists to make impossible to miss.
2. **Zero config lines: an omitted `flow:` selects the built-in.** If wrong: the headline narrows to the paper cut the old factory made people pay.
3. **Memory is composed in by the app, never switched on in the stock kind.** If wrong: every team carries memory machinery it didn't ask for.

**What would change my mind on 1:** a named app already scheduled to build its own agent seat on a different shape. Reasoning and what lost: [DECISIONS.md](DECISIONS.md). The rules every child obeys: [BUSINESS-RULES.md](BUSINESS-RULES.md).

## Reviewers · look here

- **Is it seven or six?** FIX-1361, the contract issue, was challenged three times as a duplicate of FIX-1363's own spec gate. Kept with a collapse trigger. That call could still be wrong.
- **Rules → ER-4 and ER-5.** The memory fence and the composition seam. If the fence falls, the epic's scope changes, not one issue's design.
- **Plan → the soft dependency on W2's default prompt.** Partially shipped. Check the table against the repo, not the ticket.

**Not here:** any single issue's approach, architecture or test plan. Those are the seven spec PRs.

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · Linear FIX-1359 · Project: Workforce, Layer 2 · **never merges**, stays open for the life of the epic

<details>
<summary><b>How to review this</b> — an epic-spec, not an implementation plan</summary>

*(the epic-PR contract, pasted verbatim from `epic-spec-template.md`)*

</details>
