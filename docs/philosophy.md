# Philosophy

How we think about building `@flow-state-dev`. This is the apex of the grounding:
architecture contracts, best practices, and process protocol all descend from it.
When a lower doc and this one disagree, either the lower doc is wrong or this doc
has a gap — resolve it, don't route around it.

This is not a rulebook. It is the small set of convictions the rules are *derived
from*. A best practice with no tenet behind it is a smell (see "Best practices are
derived", below). Keep this doc short and deep. If it grows into a checklist, it
has failed.

---

## What FSD is

FSD is **infrastructure, not an application**. Every AI feature needs the same
plumbing: call a model, stream the response, hold state, retry, render, resume.
Teams rebuild it every time. FSD's reason to exist is to own that plumbing as
composable primitives — four block kinds, capabilities, patterns — so app authors
compose instead of rebuild.

Everything below follows from that. The framework's value is what it *absorbs* for
every app, so the framework must stay something every app can trust: coherent,
small, and free of any one app's or vendor's knowledge.

**Scope — framework vs. labs/apps.** These tenets govern the **framework** packages
(`@flow-state-dev/*`, `@thought-fabric/*`). The **labs** and example apps (`labs/*`,
`apps/*`, `examples/*`) are *consumers* that demonstrate the framework — domain logic
and app-shaped code legitimately live there. When you work in labs code, "absorb
infrastructure, not knowledge" is not a rule against having domain logic; it's the
line you apply when deciding whether something in a lab has become general enough to
belong *back in the framework*. Coherence, composition, restraint, and readability
apply everywhere; the framework/app boundary tenet (4) is specifically about the
public framework surface.

---

## The two failures we guard against

Rank them. When you can only prevent one, prevent the first.

1. **Incoherence (primary).** Patterns that disagree — with each other, with the
   architecture, or with this philosophy. Each PR is locally reasonable; the whole
   loses its shape. This is the failure that a review of any single diff cannot
   catch, which is exactly why it's primary. Most "the spec was directionally right
   but the design feels off" moments are incoherence surfacing late.

2. **Bloat (close second).** Surface that never earned its place — a feature where
   composition would do, a knob where a default would do, an export no caller
   needs, a doc no one reads. Bloat is not just waste. Left alone it *becomes*
   incoherence: the more surface there is, the more ways it can disagree with
   itself.

They are the same enemy on two timescales. Coherence is bloat prevention that has
already compounded.

**Where we are today.** The framework carries known bloat and incoherence — surface
that accreted before these tenets were written down. We are actively removing it. So
when you spec or implement a feature and pass through code that strains a tenet, take
the opportunity to better align it as you go: refine the substrate, delete a dead
path, reconcile a conflicting pattern — within the change's scope and flagged for
review, not as unbounded side-quests. Opportunistic alignment is how the loop pays
down the debt without a separate cleanup project stalling feature work.

---

## The tenets

### 1. Coherence over local cleverness

A solution that fits the established shape beats one that is better in isolation.
Conformance outranks taste *inside* the codebase.

**Coherent with what?** In priority order, a change must cohere with:

1. this philosophy,
2. the architecture contracts (`docs/architecture/*`),
3. the established patterns in the surrounding code,
4. itself (one change, one shape — no blending two approaches).

These references can also disagree with **each other** — most often a written
architecture doc and the code as-built. Don't silently rank one over the other; a
doc/code mismatch is itself incoherence, and the move is to surface it and resolve
it deliberately (fix the code, or update the doc — decided, not defaulted). And when
something is incoherent and *nothing* above disambiguates it, that is a **gap in the
philosophy**, not just a bad diff: sharpen the grounding, then the code. Papering
over drift while the grounding stays silent guarantees the next author drifts the
other way.

*Derives:* BP-001 (doc authority precedence), the Philosophy Skeptic review, the
coherence audit.

### 2. Composition over features

FSD's power is that a few primitives — the four block kinds, capabilities, patterns
— compose into anything. So the first question for any capability is not "what
feature do we add?" but "what composition of what exists already expresses this?"
Most asks are compositions in disguise. Reserve a genuinely new primitive for what
cannot be composed from the current ones — and when you do add one, it has to
compose cleanly with the rest, or it fractures the model everything else relies on.

Primitives should stay **few, highly impactful, and flexible.** When a request
strains what exists, that friction is a signal: the move is usually to *refine the
substrate* — subtract then add, or realign an existing primitive so it covers the
new case — rather than pile on another concept. A rare, high-cost edge case is not
worth a framework change; a genuine gap in the primitives is an opportunity to
improve how the framework operates. **Refine, don't accrete.**

*Derives:* BP-029 (compose over reimplement), the pattern and capability libraries,
the necessity gate's refinement lens ("does this friction reveal a way to sharpen a
primitive?").

### 3. Earn every addition

The default answer to "should this exist?" is no. Every new export, option, and
dependency is a contract you can't take back, so it has to earn its place against
what's already there. Prefer a default over a knob; prefer extending an existing
shape over introducing one.

And subtract as you go: a change that supersedes a path deletes it in the same
change. Old and new side by side is how incoherence starts.

*Derives:* BP-038 (build the least; subtract), BP-004 (public boundary first), the
necessity gate, the simplification review.

### 4. The framework absorbs infrastructure, not knowledge

FSD absorbs what most AI apps rebuild. It does **not** absorb one app's domain logic
or one vendor's specifics — those live in app code or behind escape hatches
(`providerTools`, raw `tools`, `uses`).

The line is **balanced, not purist**: opinionated defaults earn their place, and
ergonomic surface is allowed when most apps would want it. But the test before
adding to the public surface is "would this serve apps broadly, or is it one
caller's knowledge leaking into shared infrastructure?" A feature that exists in a
single vendor's API with no analog elsewhere is a signal to push back toward the
escape hatch, where the lock-in is visible at the call site.

*Derives:* BP-031 (never decide from caller-controllable input), the necessity
gate's single-vendor-leakage signals.

### 5. Fix at the owning layer

When a failure forces a workaround at the call site, the bug usually lives one layer
down. Push the fix to the layer that owns the behavior so it's cured for every
caller, not repeated at each. A workaround every caller must copy is a smell.

*Derives:* BP-028.

### 6. Readability is an output

The human is the decision-maker, and humans review by pattern, smell, and
direction, not by absorbing density. So the artifacts humans read — specs, PRs,
this doc — owe them the right altitude: the problem, the shape of the solution, the
tradeoffs, and the decisions, *before* the deep detail. Density is a cost we pay
deliberately where it buys precision (the agent-facing half of a spec, a contract
definition), never by default.

*Derives:* BP-039 (specs lead with plain language), the spec's two-part structure.

### 7. Prove the goal, not the mock

A deliverable is not done because tests are green. It is done when something
exercises the **real path** and shows the outcome a user would care about. Mocked
tests prove the pieces; a real-model goal check proves the point. And tests must
encode *why* a behavior matters, not just *what* it does — a test that can't fail
when the business logic changes is not a test.

*Derives:* BP-003 (verification evidence), the two-kinds-of-test discipline.

---

## When tenets collide

They will. The two most common collisions:

- **Coherence vs. restraint** — matching the established pattern costs more code;
  the minimal solution introduces a new shape.
- **Absorb vs. minimal surface** — the ergonomic thing to absorb grows the public
  surface.

The rule is **surface the tradeoff; do not average it, and do not pick silently.**
Averaging two patterns produces a third that matches neither — the worst outcome for
coherence. When the collision is real and load-bearing, escalate it to the human
with the tradeoff named. That is not indecision; it is refusing to make a coherence-
shaping call in the dark.

And the point of surfacing is not only to pick a side. A genuine deadlock between
coherence and restraint is often the sign that a *third* move exists — refine the
primitive so the dilemma dissolves (tenet 2). Look for the subtract-and-add before
you settle for either horn. (Small, obvious collisions you resolve and note; the
gate is for the ones that shape the design.)

---

## Philosophy → tenets → best practices

The grounding has three tiers, each derived from the one above:

1. **Philosophy** — the convictions above (what FSD is; the two failures).
2. **Tenets** — the stable, enumerable rules of thought the convictions yield (the
   seven above). Always in force.
3. **Best practices** — the *situational* refinements of the tenets: concrete,
   testable guidance for a specific area. The volatile tier.

The lasting layer is the **tenets**. Best practices are specific by nature, so they
must stay **few** — we do not want dozens or hundreds. Most situational guidance is
worked out **per spec**: for the solution at hand, reason from the tenets plus the
handful of common best practices already established, and name the 1–5 that fit
*this* change. You are not meant to consult, or grow, a large global registry.

Every BP still traces to a tenet; one that serves none is miscategorized or a sign a
tenet is missing. Sharpen or prune before you add — tenet 3 governs our own grounding
as much as our code. Tenets endure; best practices earn their place one at a time and
stay a short list.

---

## Using this doc

- **Specs** argue *from* these tenets and name the 1–5 most load-bearing for the
  change. Reviewers read at this altitude first.
- **Implementation** follows the spec, but when the code contradicts the spec's
  reasoning, that contradiction is evidence — surface it (tenet on collisions),
  don't force-follow or silently deviate.
- **Review** has a dedicated altitude — the Philosophy Skeptic — that checks the
  design against these tenets and against the patterns the code already embodies.
- **The codebase** is audited for coherence with this doc; where it's incoherent
  and this doc is silent, that's the signal to sharpen this doc.

Authority order: **this doc → `docs/architecture/*` → `docs/contributing/best-practices.md` → `AGENTS.md`.**
The `CLAUDE.md` behavioral guidelines are general engineering hygiene; these tenets
are FSD-specific conviction and sit above them.
