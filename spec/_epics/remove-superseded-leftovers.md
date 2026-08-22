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
| **Public surface** (reachable from a package's `src/index.ts` or its `exports` map) | A **named successor with an equivalent contract**. A grep is not sufficient and never was. If you cannot name what replaces it, it is not a leftover. A **rename** satisfies this by shipping its successor in the same change — the test there is that the contract is identical and the new name is exported before the old one goes, not that the new name predates the PR |
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

6. **Sequencing: one hard constraint, and a soft order beneath it.** Every slice is based on
   `main`, not stacked, so with a single exception they may merge in any order and none should
   be held for another.

   **Hard — #1394 (docs, FIX-1213) must not merge before #1387 (unread options, FIX-1210).**
   #1394's CLI page states that `fsdev run --seed-user` and `--seed-org` are still accepted,
   seed nothing, and are being removed. #1387 is the change that removes them. In that order the
   sentence is true when it publishes and true afterwards. Reversed, `main` carries published
   documentation announcing a removal that has not happened, against a CLI whose `--help` still
   advertises both flags — a *new* lying surface, introduced by the epic whose whole objective is
   removing them.

   Checked against the tree rather than assumed. On `main`, `packages/cli/src/commands/run.ts`
   declares both options and reads them in exactly one place: they are echoed verbatim into the
   `--capture` payload, so neither ever reaches a store. On `origin/cleanup/unread-options` the
   options, their type fields and that echo are all gone, and three agent skills under
   `.agents/skills/` that still invoked `--seed-user` are fixed in the same branch.

   This is the only ordering rule in the set whose violation costs correctness rather than a
   rebase, which is why it is stated separately from the guidance below. Everything else here is
   guidance.

   **Soft — barrel-heavy breaking slices first, docs last.**
   Twenty-nine files are touched by more than one slice — all barrel and index files. Calling
   the resulting rebases "trivial" was optimistic: each merge re-conflicts the slices that
   haven't landed, so the cost compounds with the number outstanding rather than being paid
   once. Independence is still the right trade against a six-deep stack that serializes every
   review, but there is a **soft merge order that costs nothing and avoids most of the
   thrash**: the barrel-heavy breaking slices (FIX-1209, FIX-1210) first, FIX-1211 next, and
   **FIX-1213 (docs) last**, so the docs land against the code they describe rather than
   drifting between merges. FIX-1155, FIX-1212, FIX-1214 and FIX-1215 touch almost nothing
   shared and can go whenever. This half is guidance, not a gate — merging out of *this* order
   costs a rebase, not correctness. The constraint above it is the one that is a gate.

7. **A change that doesn't serve the objective is a satellite, not a member.** Two qualify, both
   trapped in #1369: FIX-1155 (a request-scope race fix) and FIX-1214 (BP-012 items-log residue).
   Neither follows from "no lying surface" — a race is a defect, and an echoed payload is noise.
   Each keeps its own PR and its own evidence, and neither counts toward completion, so approving
   §1 does not authorise them and the epic does not wait on them.

   The line between a satellite and a member is §1's five categories, not whether the change is
   behavioural: FIX-1215 changes behaviour and is a **member**, because removing a superseded
   shim is squarely category one. "Over-engineering" is deliberately not among the five, which is
   what puts FIX-1214 outside.

## 3. Shape of the whole

No end-state POC. The division was not a guess that needed checking — #1369 had already
written every cut and proved it against the tree, so the assembled shape is that PR's diff,
which exists and is reviewable. What this epic changed is how it is *presented* for review,
and a POC cannot tell you anything about that.

## 4. Running index

**Eight PRs serve the objective. Two more ride alongside as satellites** — they were trapped
in #1369 and are worth landing, but approving §1 does not authorise them and the epic does not
wait on them.

**This epic is coordinated by hand, not by `epic-lifecycle`, and that is the whole reason the
route column reads `direct`.** Review raised a sharp mechanical objection to an earlier draft:
the coordinator re-derives each child's route from its Linear category on every refresh, and
`Improvement` — which is what all of these carry — derives the **spec** route, not `direct`. So
an asserted `direct` would simply be overwritten, and every child would acquire a spec-approval
gate. That objection is correct against the automated path.

It does not apply here, because no coordinator is running this epic. The work was already done
and evidenced in #1369; each child is a PR that exists, not an approach awaiting a decision. A
spec gate in front of a finished, reviewable diff buys nothing. `direct` in the table below is a
**description of how these are actually being run**, not an instruction to a coordinator.

**If anyone later runs `epic-lifecycle` against FIX-1208, this is the thing to know first:** it
will re-derive `spec` for every child and stall the set behind gates for documents nobody needs.
Either relabel the children to a category that derives `direct`, or don't run the coordinator on
this epic. It was never built for a set whose implementation predates its epic.

**Reading the two tables below, if what you are deciding is what to merge.** They are refreshed
from the live PRs at **2026-08-22 19:05 UTC** — heads, checks and thread counts are a snapshot of
that moment, not a standing claim. Three things are worth knowing before the rows:

- **Nothing has failed.** Across all ten there is not one failing check. Where `CI` reads
  *running*, the long `Typecheck & Test` job had not finished; every job that has finished is
  green. #1392 is the exception only in that it took a new head at 19:05 and restarted its run.
- **`Threads` counts GitHub's unresolved review threads, and splits out the ones still awaiting a
  reply** — that split is the number that matters, not the total. An answered-but-unresolved
  thread is a decision recorded and left visible, which is why #1387 can carry nine and still be
  mergeable. An unanswered one is a reviewer finding nobody has responded to yet. The line between
  *mergeable* and *mid-round* below is whether the **whole** review pass is unanswered: four PRs
  (#1392, #1395, #1396, #1388) are in that state and are not merge candidates today; the handful of
  unanswered items elsewhere are late-arriving nits on PRs whose substantive rounds are closed.
- **One row is gated by something other than its own state:** #1394 is clean but must wait for
  #1387 (theme 6, the hard constraint).

### Members — completion is these

| Issue | What it delivers | Route | Kind | PR · head | CI | Threads | State |
|---|---|---|---|---|---|---|---|
| [FIX-1213](https://linear.app/fixpoint-labs/issue/FIX-1213) | Docs and agent skills stop teaching contracts that aren't on the tree | direct | docs | [#1394](https://github.com/fixpoint-labs/flow-state-dev/pull/1394) · `4548548` | running | 0 open (13 resolved) | Clean — **hold until #1387 merges** (theme 6) |
| [FIX-1209](https://linear.app/fixpoint-labs/issue/FIX-1209) | Superseded aliases, compat shims, unused internal barrels removed | direct | breaking minor | [#1390](https://github.com/fixpoint-labs/flow-state-dev/pull/1390) · `52c46fc` | green | 1 open, **1** unanswered | Mergeable — one late P2 on the changeset's `CollectionItem` migration note |
| [FIX-1210](https://linear.app/fixpoint-labs/issue/FIX-1210) | Options accepted but never read | direct | breaking minor | [#1387](https://github.com/fixpoint-labs/flow-state-dev/pull/1387) · `cada1fe` | green | 9 open, **3** unanswered | Mergeable — merge this **before** #1394 |
| [FIX-1211](https://linear.app/fixpoint-labs/issue/FIX-1211) | Duplicate helpers collapsed to one implementation each | direct | patch | [#1392](https://github.com/fixpoint-labs/flow-state-dev/pull/1392) · `96317e2` | re-running | 14 open, **13** unanswered | Mid-round — a full review pass is unanswered |
| [FIX-1212](https://linear.app/fixpoint-labs/issue/FIX-1212) | Engine org-store factories renamed off `Project` | direct | breaking minor | [#1389](https://github.com/fixpoint-labs/flow-state-dev/pull/1389) · `5b3093e` | green | 0 open | **Ready** — the cleanest row in the set |
| [FIX-1215](https://linear.app/fixpoint-labs/issue/FIX-1215) | Scope-config `clientData` shim removed | direct | **behaviour** | [#1391](https://github.com/fixpoint-labs/flow-state-dev/pull/1391) · `d436306` | running | 2 open, **2** unanswered | Mergeable, but §5 asks whether the hard throw should ship at all |
| [FIX-1216](https://linear.app/fixpoint-labs/issue/FIX-1216) | Unused internal surface and truly-dead symbols removed | direct | patch | [#1395](https://github.com/fixpoint-labs/flow-state-dev/pull/1395) · `522d359` | green | 10 open, **9** unanswered | Mid-round — three reviewers dispute the changeset's package bumps |
| [FIX-1217](https://linear.app/fixpoint-labs/issue/FIX-1217) | Remaining duplicate internal helpers collapsed | direct | patch | [#1396](https://github.com/fixpoint-labs/flow-state-dev/pull/1396) · `465c197` | running | 6 open, **6** unanswered | Mid-round — no reply yet to the opening pass |

### Satellites — related to the epic, deliberately NOT children of it

Review caught that "satellite" was decorative while these were Linear sub-issues: the epic
objective gate ramps **every** sub-issue and has no member/satellite concept, so approving §1
would have authorised them regardless of what this table said. They are now linked to FIX-1208
with `relates-to` rather than parented, which is what makes the separation real.

| Issue | What it delivers | Route | Kind | PR · head | CI | Threads | State |
|---|---|---|---|---|---|---|---|
| [FIX-1155](https://linear.app/fixpoint-labs/issue/FIX-1155) | Request-scope state writes serialize before persist | direct | bugfix | [#1388](https://github.com/fixpoint-labs/flow-state-dev/pull/1388) · `2e888cb` | running | 5 open, **1** unanswered | Mid-round — a **new P1** landed at 19:01 and has no reply |
| [FIX-1214](https://linear.app/fixpoint-labs/issue/FIX-1214) | State-only blocks stop echoing input into the items log | direct | behaviour | [#1393](https://github.com/fixpoint-labs/flow-state-dev/pull/1393) · `be33a32` | running | 1 open, **0** unanswered | **Ready** — every finding answered, two tests re-strengthened after |

**Why FIX-1214 is a satellite and FIX-1215 is not**, since both change behaviour. FIX-1215
removes a superseded shim — a §1 category, and a caller on `clientData` is holding a name that
has a canonical replacement. FIX-1214 removes BP-012 residue: blocks that echo their input into
the items log. That is noise, not a *lying* surface, and "over-engineering" is deliberately not
one of §1's five admitted categories. It rides here because it was trapped in #1369, on the same
terms as FIX-1155.

**FIX-1216 and FIX-1217 are members, and the distinction matters.** The follow-on hunt as an
*open inventory* stays out of this index — that was the whole point of removing it. But these two
are no longer open: they are a bounded, enumerated set of findings, re-verified, scoped to two
PRs. A finding that has been named and sized is work; only the search for more is unbounded. The
hunt turned up 22 Tier-1, 6 Tier-2 and 7 Tier-3 candidates; the Tier-2 public-name removals and
everything in Tier 3 are **not** filed here — where they go is §5's third open question.

**Two code findings this epic surfaced and deliberately did not absorb.** Both came out of the
docs slice (#1394) checking prose against source, and both are real defects in code that slice
does not touch. They are filed as their own issues, related to FIX-1213, and are **not** members —
they are recorded here so a later reader can see they were found and routed rather than missed.

| Finding | Where | Filed as |
|---|---|---|
| A `requireUser: false` flow throws a 500 on **every** dispatch unless a resolver returns a `userId` or `authentication.defaultUserId` is set. Opting out of user identity does not opt out of needing one — request bookkeeping is keyed by it. | `packages/engine/src/transports/host/createInboundTransportHost.ts` | [FIX-1218](https://linear.app/fixpoint-labs/issue/FIX-1218) (Bug, Medium) |
| The file header describes the pipeline as `body → idempotency → gateway auth`; the code authenticates **first**, deliberately, so an unauthenticated caller cannot probe dispatch history through the duplicate-vs-401 oracle. Header and inline comment contradict each other. | `packages/scheduled/src/routes.ts` | [FIX-1219](https://linear.app/fixpoint-labs/issue/FIX-1219) (Improvement, Low) |

The docs slice documented the first in `docs/architecture/authentication.md` and corrected the
ordering in `docs/architecture/scheduled-actions.md`, then stopped. The code traps are unfixed on
`main`. That restraint was right and is worth stating plainly, because the tempting move was the
wrong one: **#1394 changes no source file, and that property is what makes it reviewable as a
docs-only diff.** Reaching into `packages/engine` to fix a 500 would have bought one fix and cost
the reviewer the guarantee that nothing in a 78-file documentation change can alter behaviour.

Epic issue: [FIX-1208](https://linear.app/fixpoint-labs/issue/FIX-1208). Supersedes [#1369](https://github.com/fixpoint-labs/flow-state-dev/pull/1369), which carried
all of the above as one 266-file change.

## 5. Open cross-cutting questions

**Three questions are open, and all three are the product owner's to answer.** None is blocked on
more engineering work — each has been researched to the point where what remains is a business
call about what we are willing to break and how much of this we are willing to keep open. Every
other *cross-cutting* decision has been made and is recorded in the evolution log below; what is
still open on individual PRs is review feedback, and §4's `Threads` column is where that lives.

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

- **Should #1391 hard-throw on a removed `clientData` key, or warn for one more release?**
  Today on `main` a flow that still sets scope-config `clientData` warns once and keeps working.
  #1391 makes it throw at `defineFlow` — the app fails to start rather than starting with a
  deprecated key. Both are defensible; the fork is how much notice we owe someone who has not
  read a changelog.

  **The trade being accepted:** throwing means a consumer still on the old key discovers it the
  first time they boot, loudly, with an error naming the replacement — instead of shipping for
  another cycle on a shim while their code drifts further from the real API. Warning for one more
  release buys them a quieter migration and costs us one more release carrying exactly the kind of
  double-named surface §1 exists to remove.

  *Recommendation: keep the throw.* We are pre-1.0, the replacement (`client.expose` /
  `client.derived`) is live and documented today, and the error message names it at the point of
  failure — which is a better migration experience than a warning nobody reads in production.

  **What would change the recommendation:** knowing of a consumer who cannot take a startup
  failure on an upgrade — anyone deploying without a staging boot, in particular.

  **One rider, and it points opposite ways depending on the answer.** An open Codex finding on
  #1391 notes that TypeScript still accepts `clientData` on a scope literal that carries any other
  valid key, so a consumer gets no compile-time signal before the runtime throw. Adding
  `clientData?: never` to the scope config types would turn the throw into a compile error, which
  is **strictly better if the throw stays** — the failure moves from boot to build. If instead we
  revert to a warning, the same change is **wrong**: it would break at compile time the callers we
  just decided to let keep working. So this finding should not be actioned until this question is
  answered.

- **Do the bloat hunt's Tier 2 and Tier 3 findings join this epic, or start their own?**
  The hunt produced 22 Tier-1, 6 Tier-2 and 7 Tier-3 candidates. Tier 1 is in the set as FIX-1216
  and FIX-1217. The other 13 have nowhere to be yet.

  **This does not reopen the resolved question below it.** That one settled that an *open-ended*
  hunt must not grow the set — a search with no stopping rule can expand an epic past the
  objective its gate approved. Tier 2 and Tier 3 are the opposite: named, counted, and re-verified.
  The question is only where a bounded remainder goes, which is the same test §4 applies to admit
  FIX-1216 and FIX-1217 as members.

  **The trade being accepted:** folding them in finishes the sweep in one pass, with one review
  context, while everyone still has it loaded — and stretches an epic that already has ten open
  PRs, pushing its completion further out. Splitting them off keeps this set closable this week
  and pays a re-familiarisation cost later, plus a second objective gate.

  *Recommendation: a separate epic, and not immediately.* Ten PRs is already more than this set
  can carry; Tier 2 is public-name removals, which is precisely the category §1 says needs the
  most careful evidence, and that deserves its own objective rather than riding one approved for
  something else.

  **What would change the recommendation:** if Tier 2 turns out to overlap the same barrel and
  index files these ten already touch, doing it separately means paying the 29-file rebase tax a
  second time — that would argue for folding at least the overlapping part in now.

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
- **After the third epic-PR review round** — made FIX-1214 a satellite alongside FIX-1155.
  Removing BP-012 items-log residue is not one of §1's five categories, so counting it toward
  completion would have let objective approval authorise work the objective never implied.
  Generalised theme 7 to say what makes something a satellite, since "it changes behaviour" was
  the wrong test — FIX-1215 changes behaviour and is a member. Added a `Route` column and stated
  why there is no Spec-PR column: every child is `direct`, so the column would be dashes implying
  a spec-review trail that does not exist. Folded the bounded wave-2 findings (FIX-1216, FIX-1217)
  into the index as members, which is consistent with keeping the *open* hunt out: a finding that
  has been named and sized is work, only the search for more is unbounded.
- **After the fourth epic-PR review round** — detached FIX-1155 and FIX-1214 from FIX-1208 into
  `relates-to` links. Review established that the objective gate ramps every sub-issue and has no
  member/satellite concept, so the designation was decorative while they were children: approving
  §1 would have authorised them whatever this document said. Also stated plainly that this epic is
  coordinated by hand — a coordinator would re-derive the `spec` route from the `Improvement`
  category and stall a set whose implementation already exists behind gates for documents nobody
  needs.
- **All ten PRs opened** — eight members and two satellites, every one ready for review rather than
  draft so the automated reviewers engage. The set that replaces #1369's single 266-file change is
  now on the board; #1369 itself can be closed as superseded.
- **After the fifth review round** — clarified that a rename satisfies the public-surface bar by
  shipping its successor in the same change. As written, the bar demanded a successor that already
  existed, which would have disqualified FIX-1212 (the org-store rename creates
  `createInMemoryOrgStore` rather than pointing at one already on the tree). The intent was always
  "nobody loses a capability", not "the replacement predates the PR".
- **`FSDEV_DEBUG_ITEMS` removal kept, not deferred** (#1390). The fork was: cut the runtime env
  fallback now, or revert it from this slice, un-suppress the deprecation warning so production
  finally sees it, and delete it next release. A reviewer argued for deferring on the grounds the
  fallback was 13 days old (PR #1110) — and that provenance was simply wrong. #1110 is a
  process-docs change that never touched `packages/core`; the fallback landed in `01a2897` on
  2026-04-21 under the file's old `src/utils/` path, four months ago. With the premise gone, the
  deferral had nothing left holding it up: we are pre-1.0, the "one release cycle" the original
  commit promised has elapsed several times over, and buying one more visible cycle would mean
  carrying a known lying surface through the epic whose objective is removing them. What survives
  of the finding is real — the warning was suppressed under `NODE_ENV=production`, so a deployment
  setting the variable was never told — and duration does not help someone who was never warned.
  So it ships loudly instead of quietly: its own labelled section in the changeset, and point 1 of
  #1390's *Parts worth reviewing closely*.
- **#1388: `mutationTimeoutMs` documented as ignored, not excluded from the type.** The fork was a
  JSDoc contract versus a type-level one. A knob whose documentation states plainly that it is
  ignored when `persist` is set, and why, is not a lying surface — only a silent one is. Type
  exclusion would be marginally better and would cost an options-type split, which is not worth
  churning an already-approved fix for a marginal gain.
- **#1388's changeset stays `patch`, not `minor`.** I instructed `minor` on the premise that
  consumers were losing a timeout on persist-backed scopes, and the worker refused with evidence:
  on `main`, `state-container.ts:134` gates the whole timeout path behind `if (persist ===
  undefined)`, so no persist-backed scope ever had a budget to lose. `minor` would have advertised
  a change no consumer can observe. Recorded because the correction ran against my own
  instruction, and because it is not an exception to theme 5 — theme 5 governs public-name
  removals, and this is a bugfix that removes no name.
- **Merge order acquired its first hard constraint** — #1394 must not merge before #1387 (theme 6).
  Until now every slice was based on `main` and genuinely order-independent, with only a soft
  preference to reduce rebase thrash. #1394's CLI page now describes `--seed-user` / `--seed-org`
  as accepted-but-inert and being removed, which is true only once #1387 lands. Recorded as a
  constraint rather than a preference because the two carry different costs: the soft order buys
  fewer rebases, this one prevents publishing a false claim about our own CLI.
- **Two code findings routed out rather than absorbed** — FIX-1218 (`requireUser: false` throws a
  500 on every dispatch without a `defaultUserId`) and FIX-1219 (the scheduled-dispatch header
  comment states the wrong auth/idempotency order). The docs slice found both while checking prose
  against source, documented what it could in the architecture docs, and declined to fix either.
  The fork was whether a docs PR may reach into `packages/engine` to fix a live 500 it just
  discovered; the answer is no, because "#1394 changes no source file" is the property that makes
  a 78-file docs diff reviewable at all. Both are filed against Framework simplification & cleanup
  and related to FIX-1213.
- **Index refreshed against the live PRs** (2026-08-22 19:05 UTC) with heads, CI and unresolved
  review-thread counts, and the state column re-pointed at merge-readiness rather than at "In
  Review", which every row said and which told a reader deciding what to merge nothing. The
  refresh is what surfaced that four PRs (#1392, #1395, #1396, #1388) are carrying unanswered
  review passes rather than being merge candidates, and that #1388 took a new P1 at 19:01.
