# Epic — Remove superseded leftovers

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** Make the framework's surface tell the truth about itself. Today a developer
who copies an example from our docs can hit code that fails typecheck, or pass an option
that is accepted, typed, and then silently ignored. Both cost the same thing: the developer
trusts the surface, the surface lies, and they lose an afternoon finding out. When this epic
lands, the framework has **no lying surface**: docs match the tree, an accepted option is
read, and a superseded name is gone. Real exports that nothing in this repo happens to call
are not lies — they stay, and saying so here is what stops a later sweeper reading this
objective as a mandate to remove them.

**Holistic necessity.** This is a cleanup epic, which is exactly the kind that overbuilds by
mistaking *unused* for *dead*. So the set is bounded by one product rule, and every issue
under it is subordinate to it:

> **An unused public export is not a leftover.** This is a framework. A feature with no
> in-repo caller is the normal case, not a smell.

A cut earns its place only as a **superseded alias** (a second name for something that still
has a canonical name), a **dead knob** (an option no code reads), a **retired experiment**
(the successor already shipped), an **internal duplicate**, or an **unused internal**
surface. Everything else stays. Applying that rule is what turned the original 266-file pass
from a public-API purge into a leftover cut, and it is the single thing most likely to be got
wrong on a follow-up sweep.

**Proof, and it is not the same proof for every cut.** An earlier draft of this line said the
evidence was *a grep showing no live referent, **or** a successor* — and that `or` is the bug.
It lets a public removal pass on repo search alone, which is precisely what the product rule
rejects, because external consumers are invisible to a grep. It already produced one false
positive: the `@flow-state-dev/claude-code/cli` retirement, justified solely by "no in-repo
caller", when `/cli` and `/sdk` are two separately exported, separately documented contracts.

So the bar depends on what is being cut:

| Cutting | The evidence that counts |
|---|---|
| **Public surface** (reachable from a package's `src/index.ts` or its `exports` map) | A **named shipped successor with an equivalent contract**. A grep is not sufficient and never was. If you cannot name what replaces it, it is not a leftover |
| **A dead knob** | The **read that does not exist** — the option is declared and destructured, and no code consumes it |
| **Internal surface** (not reachable from any package entry) | A repo-wide grep with **zero** referents, plus the check that it is absent from the entry and the `exports` map |
| **An internal duplicate** | The clone bodies are **contract-identical**, shown side by side |

Cuts land with their evidence in the PR body, not as an assertion.

**Lead measure.** Sub-PRs whose cuts are individually evidenced and green, named each report.

**Kill line.** If the re-verification pass finds that a meaningful share of the proposed cuts
are actually live framework surface, this stops being a cleanup and becomes an API-change
epic that needs its own product decision. Reaching for that would mean the product rule
above was not doing its job.

**Not doing:**

- **An unused-export sweep.** The single most tempting follow-on and the one that would undo
  the product rule. Deliberately out.
- **`createModelResolver()` zero-config env auto-load and the `GeneratorModel` adapter**
  (FIX-852) — ~1,900 LOC with live callers (`createExecutionContext`, `createFlowState`, CLI
  `run`/`chat`/`dev`, `runBenchmark`, the trading-desk judge). Cutting it here breaks those
  hosts. Needs its own spec.
- **Extracting `core/src/models/` to `@flow-state-dev/models`** (FIX-509) — a package split,
  not a deletion, and blocked on FIX-852.
- **Unifying scope-state (7 mutators) against resource-state (4)** (FIX-1154) — unifying by
  adding resource mutators *adds* code. Out of a cleanup.

## 2. Themes & long-horizon direction

1. **The product rule is the epic's only real constraint, and it binds every sub-PR.**
   No PR under this epic removes a public export purely because nothing in this repo calls
   it. A PR that finds itself wanting to must comment up here rather than decide locally.

2. **A PR is split when its cuts have different falsification modes, or when it won't fit
   under review.** Two tests, and a slice needs to pass only one.

   *Different falsification mode* means: what a reviewer does to prove the cut wrong is a
   different procedure. Removing an alias is falsified by finding a consumer who still holds
   the name — a judgement about framework surface. Removing an unread option is falsified by
   finding a `read` of it — a mechanical grep with a definite answer. A rename is falsified by
   finding a persisted format that moved. A behaviour change is falsified by finding a caller
   whose working code now breaks. Those are four different questions and they don't review
   well stacked.

   *Won't fit* means the 100-file wall that made automated review refuse #1369 outright.
   `aliases` (71 files) and `unread-options` (56) are separate on the first test **and** would
   breach the wall combined; either reason alone would be enough.

   **Both tests are thresholds, not a taxonomy.** A slice does not split every time a second
   falsification mode appears in it — only when that mode carries enough volume to change how
   the PR is reviewed. FIX-1209 is the live example and the judgement is deliberate: it is
   mostly superseded aliases (successor-equivalence review) but also deletes a handful of
   unused internal barrels (no-referent review). Four files is not a second review; it is four
   lines a reviewer checks on the way past. Had it been forty, they would have moved to
   FIX-1216, which is exactly that mode at volume.

   Splitting past both tests is ceremony. If a further split is ever forced by size alone, it
   splits by size — not by inventing another "kind".

3. **A cut that changes runtime behaviour is never in a cleanup PR.** The failure #1369 is
   being re-landed to avoid was not only its size — it was that a reviewer skimming a cleanup
   had no reason to expect a semantic change inside it. So behaviour changes get their own
   lane regardless of how small or how cleanup-adjacent they look: the `.tap()` conversions
   (which change a block's output and the items log) and the scope-config `clientData` removal
   (which turns a working flow definition into a hard throw) are behaviour, not leftovers, and
   neither rides in a cleanup slice. Both were caught in epic-PR review after an earlier draft
   of this document had them filed as cleanups.

4. **Evidence travels with the cut, in the PR that makes it.** A removal's justification is
   the grep or the successor, and it belongs in the body of the PR a reviewer is reading —
   not in this document, and not in a comment on the original PR.

5. **Public-name removals are pre-1.0 minors and carry a changeset.** Being wrong costs a
   minor bump and a one-line rename for an out-of-repo caller. That price is what makes these
   decidable at engineering altitude; a cut whose blast radius exceeds it escalates.

6. **Sequencing: the slices are independent and may merge in any order.** They are all based
   on `main`, not stacked. No slice blocks another, and none should be held for another.

   Twenty-nine files are touched by more than one slice — all barrel and index files. Calling
   the resulting rebases "trivial" was optimistic: each merge re-conflicts the slices that
   haven't landed, so the cost compounds with the number outstanding rather than being paid
   once. Independence is still the right trade against a six-deep stack that serializes every
   review, but there is a **soft merge order that costs nothing and avoids most of the
   thrash**: the barrel-heavy breaking slices (FIX-1209, FIX-1210) first, FIX-1211 next, and
   **FIX-1213 (docs) last**, so the docs land against the code they describe rather than
   drifting between merges. FIX-1155, FIX-1212, FIX-1214 and FIX-1215 touch almost nothing
   shared and can go whenever. This is guidance, not a gate — merging out of order costs a
   rebase, not correctness.

7. **FIX-1155 is a satellite, not a member.** It is in this set only because it was trapped in
   #1369, and the objective — no lying surface — does not imply a request-scope race fix. It
   keeps its own PR and its own regression test; it does not count toward the set's completion,
   and §1 should not be read as having promised it.

## 3. Shape of the whole

No end-state POC. The division was not a guess that needed checking — #1369 had already
written every cut and proved it against the tree, so the assembled shape is that PR's diff,
which exists and is reviewable. What this epic changed is how it is *presented* for review,
and a POC cannot tell you anything about that.

## 4. Running index

**The set is seven PRs: five cleanups, two behaviour changes.** FIX-1155 rides alongside as a
satellite (theme 7) and does not count toward completion.

| Issue | What it delivers | Kind | PR | State |
|---|---|---|---|---|
| [FIX-1213](https://linear.app/fixpoint-labs/issue/FIX-1213) | Docs and agent skills stop teaching contracts that aren't on the tree | docs | — | Pending |
| [FIX-1209](https://linear.app/fixpoint-labs/issue/FIX-1209) | Superseded aliases, compat shims, unused internal barrels removed | breaking minor | — | Pending |
| [FIX-1210](https://linear.app/fixpoint-labs/issue/FIX-1210) | Options accepted but never read | breaking minor | — | Pending |
| [FIX-1211](https://linear.app/fixpoint-labs/issue/FIX-1211) | Duplicate helpers collapsed to one implementation each | patch | — | Pending |
| [FIX-1212](https://linear.app/fixpoint-labs/issue/FIX-1212) | Engine org-store factories renamed off `Project` | breaking minor | — | Pending |
| [FIX-1214](https://linear.app/fixpoint-labs/issue/FIX-1214) | State-only blocks stop echoing input into the items log | **behaviour** | — | Pending |
| [FIX-1215](https://linear.app/fixpoint-labs/issue/FIX-1215) | Scope-config `clientData` shim removed | **behaviour** | — | Pending |
| [FIX-1155](https://linear.app/fixpoint-labs/issue/FIX-1155) | Request-scope state writes serialize before persist | *satellite bugfix* | — | Pending |

**The follow-on bloat hunt is not in this index, and that is the point.** It found 22 Tier-1,
6 Tier-2 and 7 Tier-3 candidates, and folding an open inventory into a bounded set would let
the epic grow without ever re-gating §1. Its findings become their own filed issues under the
same product rule; if they amount to a set, they get their own epic with its own objective
gate. This epic completes when the seven above are merged or dropped.

Issues were filed for a mechanical reason worth recording: CI's `validate-changeset-refs` guard fails any changeset fragment that doesn't name a Linear issue, and the original PR's fragments named none. Each slice's fragments now name its issue, which is also what gives a released CHANGELOG entry a route back to the reasoning.

Epic issue: [FIX-1208](https://linear.app/fixpoint-labs/issue/FIX-1208). Supersedes [#1369](https://github.com/fixpoint-labs/flow-state-dev/pull/1369), which carried
all of the above as one 266-file change.

## 5. Open cross-cutting questions

- **Do we land the pre-1.0 minors that drop leftover public names?** Raised by the original PR,
  and the one question its author flagged for sign-off. This is the durable record; theme 5 sets
  the policy and each breaking PR's merge gate is where it is actually answered.

  **The trade being accepted:** we spend a small, certain cost on any out-of-repo consumer still
  holding an old name — a minor version bump and a one-line rename or import change, at a
  version where that is what minors are for — to stop paying an unbounded, uncertain cost on
  every new developer who finds two names for one thing and has to work out which is real.

  *Recommendation: yes*, on the strength of the successor rule in §1: every name going has a
  named replacement with an equivalent contract, so nobody loses a capability.

  **What would change the recommendation:** evidence that a specific removed name has real
  external users — a support thread, an issue, a known integrator on it. We have no telemetry
  and no download-path data, so absence of that evidence is genuinely weak; if you know of a
  consumer, that outweighs everything above for that name. The `/cli` catch is the proof this
  is not hypothetical: one cut in this set was justified on repo search alone and was wrong.

- **~~Does the continued bloat hunt grow this epic?~~** *Resolved: no.* An open-ended hunt
  inside a set with a kill line means the set can grow without re-gating the objective, which
  is exactly the "does this overbuild" failure §1 exists to catch. The hunt runs, but its
  findings are filed as their own issues and, if they amount to a set, get their own epic and
  their own objective gate. Raised by epic-PR review; decided here.

- **~~Should the running index be Linear-keyed?~~** *Resolved: yes*, and it is. Raised by
  review against an earlier revision that used bare slice labels.

---

## Epic evolution

- **Epic drafted** — split PR #1369's 266 files into six sub-PRs, one per cut kind, because
  automated review refused the original at a 100-file limit and the set contained a bugfix,
  a rename, and a docs pass that a single review question could not cover.
- **Scope extended** — added a continued hunt for stale and over-engineered code beyond the
  original pass, bounded by the same product rule, because the original stopped at what it
  could prove in one sitting rather than at what exists.
- **Set re-read against the live branch** — picked up four commits pushed to #1369 after the
  head GitHub reported, because a split derived from a stale head silently drops work. Two
  were dead knobs (`defaultBlockRenderer`, resource dynamic knobs, `fsdev run --format`), one
  collapsed the testing-harness helper clones — an item the original pass had listed as a
  known near-miss and not started — and one was a docs correction in `hello-chat`.
- **After epic-PR review** — pulled two behaviour changes out of cleanup slices into their own
  PRs (FIX-1214 tap conversions, FIX-1215 `clientData` shim), because a reviewer skimming a
  dedupe or an alias PR has no reason to expect a semantic change in it — the same failure
  theme 3 now states and the same reason FIX-1155 was already separate. Replaced "one cut kind
  per PR" with the two tests in theme 2, because "six distinct questions" was asserted rather
  than earned. Took the bloat hunt out of the running index so the set keeps a completion
  boundary.
- **After verifying a P1 against the tree** — dropped the `@flow-state-dev/claude-code/cli`
  retirement entirely. `package.json` exports `./cli` and `./sdk` as separate public subpaths
  and the README documents them as distinct contracts (cloud fire-and-forget on a claude.ai
  subscription vs in-process with Anthropic credentials), so `/sdk` is not a successor. The
  only evidence for that cut was "no in-repo caller", which is exactly what the product rule
  says is insufficient.
- **After the second epic-PR review round** — replaced §1's proof line, which said the evidence
  for a cut was a no-referent grep **or** a successor. That `or` let a public removal pass on
  repo search alone, which is the product rule's own failure mode and had already produced the
  `/cli` false positive. Evidence is now keyed to what is being cut, and public surface needs a
  named successor. Also added the soft merge order (theme 6) after a reviewer pointed out that
  rebase cost across 29 shared barrel files compounds with the number of slices outstanding
  rather than being paid once.
