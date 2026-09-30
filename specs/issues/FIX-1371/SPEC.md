# FIX-1371 · Extract the duplicated default-kind mint rule out of mintChannels and hireWorkforce

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

Improvement · `workforce` · small · 1 PR · no epic (follows [FIX-1311](https://linear.app/fixpoint-labs/issue/FIX-1311), [FIX-1361](https://linear.app/fixpoint-labs/issue/FIX-1361), [FIX-1367](https://linear.app/fixpoint-labs/issue/FIX-1367), all Done)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **changes what an omitted or unusable `flow:` means** | Edits two copies of the rule, one for workers and one for channels. Editing one passes every test | Edits one function. Both doors follow, and a test on each door says so |
| **writes a worker file with no `flow:` line** | Hired on the built-in `agent` kind | Unchanged |
| **writes a channel file with no `flow:` line** | Opened on the built-in `channel` kind | Unchanged |
| **writes `flow:` with nothing usable in a worker file** (blank, `~`, a number) | Refused, naming the worker and what was declared | Unchanged, word for word |
| **does the same in a channel file** | Refused: the `flow:` "is not a kind name". No test pins this | Unchanged, word for word, and now a test pins it |

The issue names `mintChannels`. Since FIX-1311 the channel copy lives in one function that
three channel paths share: building the channel instances, opening their sessions, and
writing the inventory. The worker copy is inline in the hire step. Those two are the only
places the rule is written: nothing else in the package reads a `flow:` key.

## The goal, and how we'll know it's met

**Whoever next changes what an omitted or unusable `flow:` means changes it in one place, and
workers and channels both follow, with nothing an author sees changing today.**

| Is it the right goal? | |
|---|---|
| **The real need** | "One shared implementation of the default-kind mint rule; both call sites use it. No behavior change." ([FIX-1371](https://linear.app/fixpoint-labs/issue/FIX-1371)) |
| **Smaller, and rejected** | Keep both copies and add a test that they agree. Still two places to edit, plus a third that has to track them |
| **Bigger, and not this issue's** | One refusal sentence for both doors, or sharing the "that kind was not passed" lookup too. The first changes what authors read; the second is outside the fence. Both are [follow-ups](PLAN.md#follow-ups) |
| **Not done if** | Either door still decides "absent, blank or not a string" itself · any refusal sentence changed · the channel door's blank, `~` and non-string cases are still untested, so a wrong extraction passes CI |

**No goal check: this is a behaviour-preserving refactor.** What proves it instead is a
table of `flow:` values (absent, empty, blank, `~`, an own key holding `undefined`, a number,
an object, a named kind), run through the worker door and the channel door. It is written and
green on today's `main`, and still green afterwards with no existing assertion edited. The
control that must fail: plant one divergence in the shared rule (read `~` as absent). The
`~` rows on **both** doors must go red, which shows both doors reach the one rule. Details:
[PLAN → Checks](PLAN.md#checks).

## What changes

![Two rows. Today the worker door checks the flow key with its own copy of the rule, and the three channel paths check it with a second copy; nothing keeps them equal. After, both doors call one rule that says which case a flow key is in. Each door keeps its own default kind and its own refusal sentences.](figures/what-changes.svg)

Follow the arrows. Today each door has its own copy of the rule. After, both reach one rule,
and each door still supplies its own default and its own words.

**What a person types does not change.** No export, file format or message changes, so there
is no diff to show. The new function is internal to the package.

## What stays as it is

- **Every refusal sentence, on both doors**, including the worker door's two (blank, and not
  a string, quoting the value) and the channel door's one.
- **The lookup that comes after the rule**: a named kind that was not passed is refused by
  each door in its own words, as today.
- **Everything else in the hire step.** The fence is the `flow:` block and nothing around it.
- **The three channel paths' shared entry point.** They keep calling the function they call
  today. That function now delegates to the shared rule.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** one rule, both doors, no
visible change. If wrong: we either leave a second copy to drift, or we slip a behaviour
change into a refactor.

1. **[D1](DECISIONS.md#d1) · The shared rule says which case a `flow:` is in. Each door keeps
   its own default kind and its own refusal sentences.** If wrong: the two doors keep wording
   the same mistake differently until someone unifies it on purpose. That costs nothing at
   runtime.

**Open: none.** D1 is the only call. Reasoning and what lost: [DECISIONS.md](DECISIONS.md).
The cases: [BUSINESS-RULES.md](BUSINESS-RULES.md).
