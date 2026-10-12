# POC · what a coordinator sends a delegate today, counted from the tree

Retained evidence for [FIX-1872](../../SPEC.md). Not production code: nothing imports it, it has
no package manifest, and it is outside default build, test, lint and knip discovery
([specs/README.md](../../../../README.md)).

## The question

Epic [FIX-1870 D2](../../../../epics/FIX-1870/DECISIONS.md#d2) asks this spec to sort today's
coordinator posts into tells (no reply expected) and posts that need an answer, before anything is
built. The answer decides whether anything becomes a plain message. The spec also rests on a list
of every file that names a surface it retires. Both are counted facts, so a script re-derives them.

**What would show the spec is wrong:** a third way onto the post entry, a route into the delivery
that isn't a post, a post entry that can end without sending anything back, or a file naming a
retired surface that the plan doesn't cover.

## How to run it

```bash
node specs/issues/FIX-1872/poc/inventory/check.mjs            # PASS on the commit this spec was written on
PLANT=1 node specs/issues/FIX-1872/poc/inventory/check.mjs    # negative control: must FAIL on F4
```

No install, no network. It reads the tree with `git grep`.

## What it showed (2026-10-12, `main` at `da8f63fd7`)

| Fact | Result |
|---|---|
| F1 · dispatchers onto the post entry | 2, both in the coordinator flow, both routes of its one delivery router |
| F2 · routes into the one delivery | 2: the judgment turn's `handOff`, and the fixed policies' picks (best fit, round robin, everyone, and every round after the first, which reroutes through the same policies) |
| F3 · what the post entry sends back | An answer or a report of none, both to the conversation that delivered it |
| F4 · files naming a retired surface | 49: 2 retire, 25 rewrite, 7 goal files that read the ledger, 4 dated verdict rows, 11 with another meaning of the word (the engine's admission `handOff`, Shift Manager's task-screen gap) |
| Negative control | `PLANT=1` adds one unclassified path; F4 fails on it, exit 1 |

**So no coordinator post today is a tell.** Every post expects an answer, so every post becomes a
task. The one message that stays plain is the round-deadline wake, which carries no answer
([BR-12](../../BUSINESS-RULES.md#rounds-and-deadlines)).

## Limits

It reads source, not behaviour. That every post *gets* an answer is the coordinator checks' job;
this only shows that no post is sent expecting none. F2 matches two source shapes, so a rewrite of
the coordinator flow will make it fail. That is intended: rerun it, and update the table, before
trusting the list again.
