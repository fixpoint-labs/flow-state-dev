# Six transferable lessons from FIX-1161's epic-spec review

*Extracted 2026-08-18 from one evening of review on `epic/building-with-fsd`. Recorded here rather
than in the epic-spec because they are not that epic's direction, and rather than in
`best-practices.md` because adding to the canon has its own bar and a decision that has not been
made. Input for `distill-lessons`, not a rule set.*

Six defects recurred often enough to name. Each is stated as the shape rather than the instance,
with the instance kept only as evidence.

---

## 1. A check must be able to fail in the exact scenario that motivated it

**Six instances in one evening**, the most common defect by a wide margin.

A rule gets written, a check gets written beside it, and the check exercises the *protected* case
only — so it passes identically whether the control is installed, misconfigured, or entirely
absent. The scenario the control exists for is the one scenario the check cannot fail in.

Instances: a digest marker never compared to anything; a dependency rule asserted of one emitted
manifest while only the other was installed strictly; a runtime floor whose rule named 22.18 while
its only refusal check exercised 20.9–21; a mounted-route proof exercising only the authenticated
request; a loopback bind proved only by a page streaming over localhost; a refuse-on-missing rule
with nothing asserting the refusal.

**The test:** name the failure the control prevents, then ask which check turns red when that
failure is present. If the answer is "none", the control is unproved regardless of how obviously
correct it looks.

## 2. Adding a control creates a new opportunity to under-prove it — and the round that adds it is least likely to notice

The corollary of #1, and the reason #1 keeps recurring. The author has just convinced themselves
the control works; the check they write is the one that demonstrates it working. **Three of the six
instances above landed on fixes made the same day**, including one added hours earlier in the same
session.

**The test:** treat a newly added control as unproved until its negative case exists, however
convinced the round that added it happens to be. Every one of the six was caught by a reader, never
by the author.

## 3. A fix applied to one of a pair presents as fixed

When a defect has siblings — the same premise stated in several places, a rule and the index that
governs it, a decision and the deferrals list that names it — fixing the instance a reviewer
pointed at leaves the others reading as current. Four instances, one of which would have let an
implementer proceed on a scope nobody had approved.

**The test:** grep the *premise*, not the phrasing a reviewer used. A correction is not done when
the owning section is edited; it is done when every surface that restates it agrees.

## 4. A verified attribution can carry an unverified one beside it in the same sentence

The subtlest of the six, because it needs nobody to be careless. Two claims share a sentence —
*"Owner decisions folded: one template, and the name"* — one of them genuinely verified, and the
pair reads as equally settled. The verified half lends its credibility to the other.

**The test:** for each claim in a compound attribution, ask separately what artifact and timestamp
it points at. And keep the weaker rule that follows from it: **absence of a record is strong
evidence, not proof** — decisions made in conversation get written up afterwards, so a reopened
question should cost its owner one line if they *do* recall deciding it.

## 5. A hand-off specific enough to file is specific enough to deduplicate

A finding described precisely enough to route to another issue is described precisely enough to
check whether that issue already covers it. Skipping the check produces duplicate work that
presents as two independent confirmations of the same thing.

## 6. Prose accumulates in whichever section was last edited under pressure

**Five length findings**, each in a different section, each following the same path: a section gets
edited under time pressure, reasoning lands where the editor was looking rather than where it
belongs, and the section becomes a second source of truth that can disagree with the first.

Worth naming honestly: one instance was **caused by the review process itself** — a coordinator
repeatedly asked for diagnoses to be recorded "in the evolution log", and the log's own rule says
reasoning is not repeated there. An instruction to record something is not an instruction about
where it belongs.

**The test:** when a section grows, ask what binds more than one consumer (keep), what is the only
copy (move, and say where), and what a more specific document already owns (delete).

---

## What these have in common

Four of the six (#1, #2, #3, #6) are the same failure at different scales: **a statement and the
thing that would falsify it drift apart.** A check that cannot fail, a control whose author writes
its check, a fix that misses its siblings, a section that outgrows the one that governs it. The
remaining two (#4, #5) are about *provenance* — where a claim came from, and whether anyone checked
it had come from somewhere already.

None of these is proposed for `best-practices.md`. That is a decision with its own bar, and six new
rules at the end of a long session is exactly the kind of addition that bar exists to stop.
