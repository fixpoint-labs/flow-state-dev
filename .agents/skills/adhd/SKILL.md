---
name: adhd
context: fork
agent: general-purpose
model: opus
description: Parallel divergent ideation — spawns N isolated sub-agents under different cognitive frames (regulator, biology, speedrunner, subtract-then-add, user-space only), scores, clusters, prunes traps, and deepens the survivors into concrete alternative approaches. Use on /adhd or "ADHD mode"; as `review`'s ALTERNATIVES lens when a change's shape is worth re-opening; and from `issue-spec` when Step 3.5 is stuck between build-and-don't-build, or Step 4 hits a design question the existing code can't answer. Skip for syntax, lookups, bugs with a known root cause, and closed phrasing ("quick", "standard", "canonical"). Keywords - alternative approaches, other shapes, third move, brainstorm, ideate, what else could this be, are we sure this is the right shape.
argument-hint: "<the problem or the change — plus any context that constrains the answer>"
---

# ADHD

Stop picking the textbook answer. The first three answers the model would give are the
answers a senior engineer would give in thirty seconds. Correct. Forgettable. The
interesting answers live past number three, in the awkward middle nobody walks into.
This skill makes the model walk there — then converges, with an opinion.

**Its bias is generative.** It exists to widen the set of candidate approaches before
one is locked in. That is the opposite posture from [`second-look`](../second-look/SKILL.md),
whose bias is removing surface, and the two are kept as separate lenses on purpose:
folded together, the critic strangles the generator and you get neither.

> **Attribution.** The method (isolated parallel branches under cognitive frames, the
> strict generate/critique split, the frame table, the trap flag) is adapted from the
> MIT-licensed **ADHD** skill by Udit Akhourii — <https://github.com/UditAkhourii/adhd>,
> which also ships a Node/TS library and CLI. Adapted here for FSD: four FSD-shaped frames
> added, and two entry contexts (spec and review) with their own convergence gates. The
> upstream package is deliberately **not** a dependency — the Agent tool runs the same
> loop with nothing to install.
>
> The upstream copyright and permission notice is retained in
> [`LICENSE.upstream`](./LICENSE.upstream) beside this file, as MIT requires for a copy of
> a substantial portion. Keep the two together if either ever moves.

## Not this skill

| Job | Use instead |
|---|---|
| Should this surface exist at all? overbuilt / YAGNI / 80-20? | [`second-look`](../second-look/SKILL.md) |
| Does it conflict with a pattern or the philosophy? | [`audit-coherence`](../audit-coherence/SKILL.md) |
| Bugs, logic errors, line-level correctness | `review`'s correctness lens, `/code-review` |
| **Which** of two known approaches is right — the claim is factual | [`settle-claim`](../settle-claim/SKILL.md) (run it, don't argue it) |
| Validating a *chosen* direction by building it | [`spec-poc`](../spec-poc/SKILL.md), [`prototype`](../prototype/SKILL.md) |

The line: this skill **generates the candidate set**. Everything above **judges a candidate
you already have.** When the complaint is "I don't think we looked wide enough," it's this
one. When it's "I don't think this one is right," it's one of those.

## Pre-flight (run before Phase 1)

This skill is expensive — 8 sub-agent calls, 5 to 10x a single answer. Do not pay
that when a direct answer is better.

**Step 1. Explicit invocation.** If the user typed `/adhd`, asked for ADHD mode, or **any
skill dispatched this deliberately** — `review` as its alternatives lens, `issue-spec` from
a Step 3.5 stall or a Step 4 design question — **skip the rest and go to Phase 1.** The
caller already chose this instrument; re-gating it here would let the self-judge below abort
a run the caller committed to (a third-move question can read as low-stakes, and an issue
whose text happens to contain "just" fails the phrasing test).

**Step 2. Self-judge** (only if Step 1 didn't match). All three must hold, or ABORT:

1. **Open-ended?** Would a senior engineer give several viable answers, or is there one
   canonical one? Canonical → abort.
2. **High-stakes?** Public API surface, a new pattern or capability, a block-kind or
   scope decision, a schema, a fuzzy bug with no known root cause → yes. A one-file
   internal helper → no.
3. **Open phrasing?** If the ask contains "quick", "standard", "canonical", "textbook",
   "just", "one-line" — they want the direct answer. Abort.

On abort, answer directly and optionally append one sentence: *"If you want a wider
exploration under parallel cognitive frames with explicit trap detection, run `/adhd`."*

## The loop

Two strict phases. Mixing them kills idea quality, because the critic strangles the
generator.

### Phase 1 — Diverge (no critic)

1. **Pick 5 frames** from the tables below. For code-shaped problems take 4 tagged `code`,
   `design`, or `fsd`, plus 1 tagged `wild`. Vary the picks between runs so re-running the
   same problem maps different ground.

2. **Spawn 5 parallel sub-agents**, one per frame, dispatched as
   `Agent tool (general-purpose, model: opus)` — **pin the model explicitly; do not let it
   inherit.** A `/adhd` run started from a Sonnet or Haiku session would otherwise fan out
   at that tier, which is the one thing AGENTS.md says this skill must not do: idea quality
   is the entire product of this phase, and the JSON-only output shape is not a reason to
   treat generation as decided execution. Each gets *only* the problem, the context the
   caller supplied, its frame's vantage prompt, and this instruction:

   > You are in DIVERGENT mode. You are a generator, not a critic.
   > Generate 6 short distinct ideas under this frame. Each idea is one phrase or one
   > sentence. Do not evaluate. Do not rank. Do not hedge.
   > The first three obvious answers everyone would give are banned. Push past them into
   > the awkward middle.
   > Output a JSON array only. No prose before or after.
   > `[{"text": "...", "rationale": "..."}, ...]`

3. **The isolation invariant.** The calls must be parallel and isolated. Do NOT serialize
   them. Do NOT pass one branch's output to another. Branches that see each other anchor
   each other, and the method collapses into one wider thought. Writing five "branches"
   sequentially in your own context is **not** running this skill.

### Phase 2 — Focus (critic on)

**Steps 1 and 2 run in your own context — do not spawn sub-agents for them.** Scoring and
clustering need to see the whole pool at once, which is exactly what a fresh sub-agent
can't. Only step 3 fans out. That context is Opus regardless of the calling session, because
`model: opus` in this skill's frontmatter sets the forked subagent's model — candidate
selection decides which ideas survive, so it belongs on the same tier as the generation.

1. **Score.** Each idea on three axes, 0–10: **novelty** (distance from the obvious
   default), **viability** (could it actually ship here), **fit** (does it address the
   stated problem). Flag any idea that is attractive but a **trap** — hidden cost, false
   economy, won't scale, premature abstraction — with a one-line reason.

2. **Cluster.** Group into 3–6 clusters by underlying angle, not surface keywords. Label
   each by its angle: "make it a capability", "push it to user space", "remove the
   framework's role", "do it at trace time".

3. **Deepen 3 — one per cluster first, score second.** Same explicit
   `model: opus` pin as Phase 1, for the same reason. Rank by
   `novelty×0.35 + viability×0.40 + fit×0.25` and drop traps. Then take the **best
   surviving candidate from each of the three top-ranked clusters** — not the top three
   overall. Only if fewer than three clusters survive do you fill the remaining slots by
   raw score.

   **This is what the clustering is for.** Top-three-by-score can be three variations of
   one underlying shape, which is the *convergence disguised as divergence* anti-pattern
   below — the skill producing exactly the narrow set it exists to prevent, while the
   breadth Phase 1 paid for gets discarded at the last step.

   One sub-agent each:

   > You are in FOCUS mode. Take one promising idea and connect dots.
   > Sketch how it would actually work in 4 to 8 sentences. Name the load-bearing risk.
   > Name the first concrete step a coder would take. Then generate 3 to 5 sub-ideas that
   > branch off (variations, combinations with other domains, things this unlocks).
   > Output JSON only.

## Frames

Pick 5 per run.

| Frame | Vantage prompt | Tags |
|---|---|---|
| **hardware engineer** | You think in latency, memory layout, and physical constraints. Re-ask this as a hardware/firmware problem. What do the bus topology, cache, and timing budget tell you? | code, wild |
| **regulator** | You audit systems for compliance and failure modes. What must be provable, traceable, or refusable here? | design, general |
| **10-year-old** | You are a curious 10-year-old who has never seen software. Describe naive but unencumbered approaches. Ignore convention. | general, wild |
| **competitor trying to break it** | You are a hostile competitor or attacker. Generate approaches that exploit, fail, or sabotage the obvious solution. Then invert them into ideas. | code, design |
| **biology** | Transplant a mechanism from biology (immune systems, neural plasticity, cell signaling, evolution, gut flora). Force-fit it onto this engineering problem. | code, wild |
| **logistics** | Steal mechanisms from logistics: queues, batching, just-in-time, hub-and-spoke, returns, last-mile. Apply them literally. | code, design |
| **game design** | Approach this as a game designer. What are the loops, rewards, friction, save-states, speedrun tricks? Treat the user as a player. | design, general |
| **markets** | Treat the problem as a market. Buyers, sellers, market-makers. What does an auction, a futures contract, a clearing house look like here? | design, wild |
| **inversion** | Ask the OPPOSITE question. If the goal is X, brainstorm how to guarantee NOT X. Then negate each answer back. | code, design, general |
| **extreme: $0 budget, 1 hour** | No money, no team, one hour. What is the crudest version that still does the load-bearing thing? | code, general |
| **extreme: infinite budget, 10 years** | Infinite compute, infinite engineers, a decade. What is the maximalist version? | design, wild |
| **remove the load-bearing assumption** | Name the thing everyone treats as fixed (the framework, the store, request-response, the network). Imagine it is gone. What is possible? | code, design, wild |
| **speedrunner** | You are a speedrunner. Find glitches, skips, out-of-bounds tricks, frame-perfect shortcuts. What is the abusive-but-legal path? | code, wild |
| **ant colony** | No central planner. Many dumb agents, local rules, pheromone trails. How does the problem solve itself emergently? | code, wild |
| **3am on-call** | You are the on-call engineer woken at 3am when this breaks. What design would let you not get paged? | code, design |

### FSD frames

Four frames that re-pose the problem in this framework's own vocabulary. They earn their
slots the same way any frame does — distinct vocabulary, distinct posture, a distortion
the others don't reproduce.

| Frame | Vantage prompt | Tags |
|---|---|---|
| **subtract-then-add** | Nothing new may be added until something is removed. Which *existing* primitive, sharpened, would dissolve this request — and what does sharpening it subsume or delete? (tenet 2) | fsd, design |
| **user-space only** | The framework may not change. An app author solves this today with escape hatches only — `providerTools`, raw `tools`, `uses`, a capability of their own, a 5-line helper. Write what they'd write. | fsd, code |
| **wrong block kind** | The shape is in the wrong place. Re-pose it as a different block kind (handler ↔ sequencer ↔ router ↔ generator), as a capability, as a resource, as a scope, or as an item type. Where does it actually belong? | fsd, code |
| **the trace** | Start at the far end: what should show up in the stream and the DevTool when this runs? Design backwards from the items a user wants to see. | fsd, design |

## The two entry contexts

Beyond direct `/adhd` invocation, this skill is dispatched from two places. **The loop is
the same; the convergence gate and the output are not.**

### A. Spec context — dispatched by `issue-spec`

**When.** [`issue-spec`](../issue-spec/SKILL.md) Step 3.5, when the necessity check is
stuck between *build* and *don't build* and the step tells you to look for **the third
move** — that stall is the strongest trigger in the repo. Or Step 4, when research
surfaced a design question the existing code cannot answer. Alternatives are cheapest
here: no code exists yet, so a better shape costs nothing to adopt.

**The gate: survivors go back through Step 3.5, they do not bypass it.** This skill
generates candidates; the necessity check still rules on them. An alternative that adds
public surface clears the same bar as the original ask — normalization, observability,
composition, vocabulary — or it dies there. Divergence that launders a wrapper feature
past the gate is a failure of this skill, not a win.

**Output.** Feed the shortlist into the spec's **§3 (Tradeoffs & alternatives)** — the
main alternative weighed and why this one wins, plus the simpler approach considered. If
divergence surfaced a genuinely live fork the user should rule on, it goes to **§6
(Decisions & rules)** in the six-part shape from
[`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md), not as a
neutral menu. Rejected branches are one line each. Do not paste the wide set into the spec.

### B. Review context — the ALTERNATIVES lens

**When.** [`review`](../review/SKILL.md) dispatches this lens **on trigger, never by
default** — it is not part of the standing lens set, because after the code exists most
alternatives are expensive regret. It fires when the caller asks for it, or when the
change trips the pre-flight gate on its own: new public API surface, a new pattern /
capability / block kind, a schema or scope decision, or a spec whose §3 weighed no real
alternative.

**Scope: alternatives only.** In this context the skill reports *other shapes the change
could have taken*. It does not report bugs (correctness lens), bloat (restraint lens), or
pattern conflicts (coherence lens).

**When divergence turns one of those up, return it — routed, not dropped.** Do not write it
as an alternatives row, and **do not try to hand it to the sibling lens**: the lenses run in
parallel as independent sub-agents, so the one you'd hand it to has no channel to receive it
and may already have returned. Put it in a separate **Routed findings** list, tagged with the
lens it belongs to, and return that alongside your rows. The coordinator's dedupe step is
where it gets merged with that lens's own findings or attributed on its own — which keeps it
from being double-counted without letting it vanish. Divergence is sometimes the only pass
that walks into a given defect; a finding this lens can't file itself still has to survive.

**The switch test.** An alternative earns a row only if **all four** hold:

1. **Materially different shape** — a different block kind, primitive, or layer. A
   variation on the same design is not an alternative.
2. **Concretely describable** — you can name the blocks, files, or surface it would be,
   in two sentences. "Could be more elegant" is not a candidate.
3. **Wins on a named axis** — less public surface, fewer moving parts, removes a whole
   class of edge case, drops a dependency. Name the axis; don't gesture at "cleaner".
4. **Switch cost stated honestly** — what moving to it costs *now*, given what's built.
   An alternative whose switch cost exceeds what it wins still earns its row, but say so
   plainly and mark it as a note for next time.

**Severity is `note` by default, and never `must-fix`.** The approach shipped; this lens
informs the next one. The one exception: if an alternative exists *because* the current
shape is actually broken or incoherent, that is the correctness or coherence lens's
finding — return it as a **routed finding** tagged with that lens instead of an alternatives
row. The coordinator sets its severity, which is how a real break can still come out as
must-fix even though this lens can't raise one.

**"The current approach is the right shape" is a valid and common verdict.** Say it in one
line and stop. Padding a review with three shapes nobody will build is exactly the noise
`review`'s no-padding guardrail exists to prevent.

**Output** (merges into `review`'s single ranked table):

```
### Alternatives lens

**Verdict:** <Current shape is right | N alternative(s) worth recording> — <one sentence>.

| # | Alternative | Wins on | Switch cost now | Sev |
|---|-------------|---------|-----------------|-----|
| 1 | <2-sentence shape> | <named axis> | <honest> | note |

**Traps flagged:** <attractive-but-wrong branches, one line of reason each>. (Omit if none.)

**Routed findings** — not alternatives; for the coordinator to classify and dedupe against
the named lens. (Omit if none.)

| Finding | Belongs to | Why it's not an alternative |
|---------|-----------|-----------------------------|
| <short> | correctness / restraint / coherence | <one line> |
```

## Output shape (direct invocation)

Render in this order. Do not collapse it into a wall of prose — the structure is the point.

1. **Brief.** One or two lines confirming the problem and any reframe used.
2. **Wide set.** The full pool grouped by cluster, each cluster labeled by its underlying
   angle, each idea one short phrase with score chips like `[N7 V8 F9]`.
3. **Converge.** A 2–4 idea shortlist, with why each is on it. Mark the
   non-obvious-but-viable pick with ★. List traps separately with their one-line reasons.
4. **Focus.** The 3 deepened branches — sketch, load-bearing risk, first concrete step,
   child ideas.
5. **Provocation.** One wildcard question that opens a direction to push into if nothing
   landed.

## Anti-patterns

- **Convergence disguised as divergence.** Ten variations of one idea is not breadth. If
  every candidate shares the same underlying assumption, you decorated, you didn't diverge.
- **Skipping the isolation invariant.** Simulating parallel branches sequentially in one
  context is a wider single thought, not this method. Use the Agent tool.
- **Weird for its own sake.** Thirty unsorted absurdities are as useless as one safe
  answer. Always converge.
- **Refusing to commit.** "Here are 20 ideas, you decide" is a cop-out and, in this repo,
  a violation of the engineer/product-owner contract. Generate wide, converge with a
  real opinion and a recommendation.
- **Mistaking added surface for a better idea.** A branch that proposes more machinery is
  not thereby more imaginative. The frames that subtract (`subtract-then-add`, `user-space
  only`, `remove the load-bearing assumption`, `$0 budget`) exist so removal competes on
  equal footing — score them on the same axes, and let them win when they win.
- **Laundering a rejected ask.** If Step 3.5 or `second-look` already killed something,
  re-proposing it under a frame's costume does not revive it. Divergence widens the set;
  it does not overturn a verdict.

## Cost

**5 diverge + 3 deepen = 8 sub-agent calls.** Score and cluster are coordinator work and
cost no extra agents — a run that spawns 10 has spawned two it didn't need. Call it 5–10x
a single answer once the coordinator's own tokens are counted.

Scale to stakes: naming one function is 3 frames × 4 ideas (6 calls); an API surface or a
new pattern is the full 5 × 6 (8 calls). Stop diverging when new candidates repeat the
shape of existing ones — the space is mapped. Do not pad to hit a number.
