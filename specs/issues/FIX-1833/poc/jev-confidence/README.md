# POC · what Jev reports for the chief of staff's posts

Throwaway evidence for [FIX-1833](../../SPEC.md). Not production code, not a test, and nothing
discovers it by default.

**The question.** Can a confidence floor alone keep the chief of staff's own asks (hire, fire,
start a project, who works here) away from a delegate, or does best fit also need the
coordinator itself as a choice?

**How it ran.** `check.mjs` asks `typesafe-ai/jev`, through Vercel's AI Gateway, best fit's one
choice question over different choice sets, twice per ask, on 2026-10-09. It calls the AI SDK as
`packages/core/src/models/evaluate.ts` does and reads the confidence Jev reports. Every row in
`results.jsonl` answered from `typesafe-ai/jev`; none failed.

```bash
# from the repo root, with AI_GATEWAY_API_KEY set
node specs/issues/FIX-1833/poc/jev-confidence/check.mjs > results.jsonl
ONLY=S node specs/issues/FIX-1833/poc/jev-confidence/check.mjs > results-shipped.jsonl
```

`results.jsonl` holds sets A to F, K and L (112 calls), asked with best fit's question on
`main`. `results-shipped.jsonl` holds S1 and S2 (44 calls): the description the plan ships, 11
asks, under #2955's question and under a question that names the coordinator.

## What it showed (choice @ confidence, two runs each)

| Ask | B · today's offer: `eng.em` only | A · `eng.em` + `eng.coder` (a floor alone) | D · `eng.em` + the chief of staff (jobs named) | E · `eng.em` + the chief of staff (description as is) |
|---|---|---|---|---|
| plain-1 · "get this feature filed…" | em 1 · 1 | em .98 · .98 | em .98 · .98 | em 1 · 1 |
| plain-2 · "File a feature for the storefront…" | em 1 · 1 | em .82 · .86 | em .92 · .88 | em .94 · .94 |
| plain-3 · "Can engineering pick this up?…" | em 1 · 1 | em .38 · .38 | cos .12 · em .02 | em .36 · .24 |
| cos-hire · "Hire someone to audit…" | em 1 · 1 | em .26 · .22 | cos .80 · .88 | cos .90 · .90 |
| cos-fire · "Fire license-auditor…" | em 1 · 1 | coder .28 · .24 | cos .98 · .98 | cos .94 · .92 |
| cos-project · "Start a project…" | em 1 · 1 | em .66 · .68 | cos .96 · .98 | em .08 · 0 |
| cos-who · "Who works here?" | em 1 · 1 | em .14 · .14 | cos 1 · 1 | cos .94 · .96 |
| cos-leg-c · "Audit… hire if none does" | em 1 · 1 | coder .44 · .40 | cos .96 · .96 | cos .90 · .92 |

`results.jsonl` also holds C and F (both delegates plus the chief of staff) and K and L (the
kitchen-sink support desk, without and with its own coordinator as a choice).

## What it settles

1. **A floor alone can't work on the DevTeam.** Best fit offers only `eng.em` (`eng.coder` takes
   tasks, not posts), and a one-option choice comes back at confidence 1 for every ask, the hire
   included (B).
2. **A floor alone can't work with two options either.** The chief of staff's asks land on a
   delegate at 0.14 to 0.68, and a plain ask at 0.38 to 0.98: the project ask (0.66, 0.68) sits
   above a plain ask (0.38). No floor separates them (A).
3. **With the chief of staff as a choice, a floor of 0.7 separates them with room.** Across C, D,
   E and F (64 calls), every delegate pick on an ask meant for the chief of staff was at most 0.20;
   every delegate pick on plain-1 and plain-2 was at least 0.76. plain-3 lands below 0.7 in all four
   sets and goes to the chief of staff's turn, which can still hand it on.
4. **The description matters, and the floor covers it.** With today's description, the project
   ask picks `eng.em` at 0.08 and 0 (E); the floor sends it to the turn. With the jobs named it
   picks the chief of staff at 0.96 or more (D).
5. **Offering the coordinator itself doesn't pull posts from a desk's specialists.** The support
   desk sent each of its 8 posts per set to the same specialist with and without its own coordinator,
   `support.help` ("Ask the support team anything."), as a choice (K, L).

## The shipped description (S1, S2)

| Ask | S1 · #2955's question | S2 · a question naming the coordinator |
|---|---|---|
| plain-1 | em .96 · .96 | em .88 · .90 |
| plain-2 | em .80 · .78 | em .78 · .80 |
| plain-3 | em .08 · .12 | cos 0 · em .06 |
| cos-hire | cos .90 · .92 | cos .88 · .88 |
| cos-fire | cos .96 · .96 | cos .86 · .82 |
| cos-project | cos .96 · .98 | cos .96 · .94 |
| cos-who | cos 1 · 1 | cos 1 · 1 |
| cos-leg-c | cos .94 · .94 | cos .90 · .88 |
| cos-delegates · "Who are your delegates?" | cos .98 · .98 | cos .98 · .98 |
| cos-add · "Add bob-copper as one of your delegates." | cos .92 · .94 | cos .76 · .72 |
| cos-hire-2 · "Bring someone on to review our open-source licenses." | cos .90 · .92 | cos .88 · .88 |

6. **The shipped description holds.** Under #2955's question, every ask meant for the chief of
   staff picked it (0.90 to 1), no ask meant for it picked a delegate, and the clear plain asks
   picked the EM at 0.78 to 0.96. The narrowest margin is plain-2, 0.08 above the floor.
7. **#2955's question needs no change.** Naming the coordinator in the question lowered the
   confidence on both kinds of ask and gained nothing (S2).

Not settled here: latency and price of a Jev call, and Claude Haiku 5.5's turn on these asks. The
goal check measures the routed path end to end.
