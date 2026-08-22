# Epic — Remove superseded leftovers

## 1. Purpose & objective *(the gated sign-off surface)*

**The problem.** A developer copies an example from our docs and hits code that fails
typecheck. Or they pass an option that is accepted, typed, and then silently ignored. Both
cost the same thing: they trust the surface, the surface lies, and they lose an afternoon
finding out.

**Objective.** Make the framework's surface tell the truth about itself. When this epic
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

6. **Sequencing: no ordering gate, one soft order.** Every slice is based on `main`, not
   stacked, so they may merge in any order and none needs to be held for another.

   **There was a hard constraint here and it was wrong** — worth recording, because it was
   asserted from the *spec's own description* of #1394 rather than from #1394's diff, which is
   the same mistake that produced the `/cli` false positive above. The claim was that #1394's
   CLI page announces `--seed-user` / `--seed-org` as accepted-but-inert and being removed, so
   it had to land after #1387 removed them.

   #1394 says no such thing. It **deletes** the two flag rows from `apps/docs/docs/api/cli.md`,
   `apps/docs/docs/cli/agent-dev-loop.md` and `packages/cli/README.md`, and rewrites the *State
   seeding* section of `apps/docs/docs/cli/overview.md` to describe `--seed-session` only,
   closing with: *"Session is the only scope you can seed."*

   That sentence is **already true on `main`**. `packages/cli/src/commands/run.ts` declares both
   options and reads them in exactly one place — lines 429–430 echo them verbatim into the
   `--capture` payload — so neither has ever reached a store. It stays true after #1387 deletes
   them. Both merge orders publish a true page, so there is nothing here to gate on.

   **Neither is #1387 docs-blind**, which closes the other half of the worry. #1387 deletes the
   same flag rows from `apps/docs/docs/api/cli.md`, `apps/docs/docs/cli/agent-dev-loop.md` and
   `packages/cli/README.md`, and rewrites the same *State seeding* paragraph. So merging #1387
   first leaves docs, `--help` and the code all agreeing; there is no window in which published
   docs advertise a flag the CLI has removed. The two branches overlap on 14 files, and those
   four doc files are among them — whichever lands second takes a rebase there, not a
   contradiction.

   What survives is a preference, not a rule: in the #1394-first order, `fsdev run --help` keeps
   advertising two flags the docs no longer list until #1387 lands. That is a CLI surface, #1387
   is the change that fixes it, and the flags are inert either way — so the mismatch is `--help`
   describing something that already does nothing. It argues mildly for #1387 first, which is the
   direction the soft order below already points.

   **The remedy this keeps attracting — "put the CLI and doc removals in one change set" — is the
   thing this epic exists to undo.** #1387 is 60 files and #1394 is 78. Combined they are 138,
   past the 100-file wall that made automated review refuse #1369 outright, and they carry two
   different review questions. That is the omnibus PR, rebuilt.

   **Soft — the rebase tax is a documentation tax, and docs go last.**

   An earlier revision said twenty-nine files are touched by more than one slice and that they
   are all barrels and index files. Both halves were wrong, and the correction changes the
   argument rather than just the number. Recomputed against all ten PR heads (`refs/pull/N/head`
   diffed against `origin/main`, files appearing in more than one set):

   | What the 45 shared files actually are | Count |
   |---|---|
   | Documentation and prose — `apps/docs`, `docs/`, `.agents/skills`, package READMEs | 28 |
   | Source | 10 |
   | Barrel / index | 6 |
   | Test | 1 |

   The compounding cost is mostly prose, not exports. Where it concentrates:

   - **#1394 (docs, FIX-1213) touches 26 of the 45, and every one of them is prose.** Zero
     barrels.
   - #1387 (FIX-1210) touches 27 — 16 prose, 3 barrels, 8 source. The largest collider by count.
   - #1392 (FIX-1211) is the barrel-heaviest: five of the six shared barrels.
   - #1391 (FIX-1215) touches 15, mostly prose — *not* "almost nothing shared", as an earlier
     draft had it.
   - #1393 (FIX-1214) touches none at all.

   **Docs last is the one ordering preference the data supports, and it supports it more
   strongly than the old framing did.** #1394 changes no source file, so it is never the PR
   another slice has to rebase around; it is the PR that gets re-conflicted every time a code
   slice lands and edits a doc alongside its change. Landing it last means it rebases once,
   against a settled tree, instead of once per merge.

   Beneath that, if you want to minimise the rest: **#1392 before the other barrel touchers**,
   since it holds five of the six. #1389, #1393, #1395 and #1396 touch two or fewer shared files
   each and can go whenever. Note that this reorders an earlier draft, which put the *breaking*
   slices first on the belief that they were the barrel-heavy ones; the barrel-heaviest PR is
   actually a patch.

   Calling the rebases "trivial" was optimistic and stays retracted: each merge re-conflicts the
   slices that haven't landed, so the cost compounds with the number outstanding rather than
   being paid once. Independence is still the right trade against a ten-deep stack that
   serializes every review. This is guidance, not a gate — merging out of this order costs a
   rebase, not correctness. Nothing in this set costs correctness.

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

**Nine issues serve the objective, eight of them with a PR open today. Two more ride alongside
as satellites** — they were trapped in #1369 and are worth landing, but approving §1 does not
authorise them and the epic does not wait on them.

**This index carries handles, not status.** Issue ids, PR numbers and what each delivers are
stable; CI results, review-thread counts and merge-readiness are not, and a committed snapshot
of them goes stale within hours while still reading as guidance. An earlier revision of this
table carried all four and was wrong twice inside one afternoon — the second time because a
ninth member (FIX-1220) was filed four minutes after the snapshot was taken. Live state lives
on the PRs. Ask GitHub, not this file.

**This epic is coordinated by hand, not by `epic-lifecycle`, and that is the whole reason the
route column reads `direct`.** Review raised a sharp mechanical objection to an earlier draft:
the coordinator re-derives each child's route from its Linear category on every refresh, and
`Improvement` — which is what all of these carry — derives the **spec** route, not `direct`. So
an asserted `direct` would simply be overwritten, and every child would acquire a spec-approval
gate. That objection is correct against the automated path.

It does not apply here, because no coordinator is running this epic. Eight of the nine members
were already written and evidenced in #1369 — they are diffs that exist, not approaches awaiting
a decision, and a spec gate in front of a finished, reviewable diff buys nothing. The ninth
(FIX-1220) is unstarted but arrives with its evidence already gathered during #1392's review, so
a spec would restate what its issue body already says. `direct` in the table below is a
**description of how these are actually being run**, not an instruction to a coordinator.

**The ceremony was waived deliberately, by the product owner, not skipped.** The instruction
standing over this epic was to turn the work into an epic *without* creating specs or issues for
anything not already filed. So there is no Spec-PR column, no per-child spec-approval gate, and
no `epic-lifecycle` routing — not because those were overlooked, but because a set whose
implementation predates its epic gets nothing from them. Reviewers have asked for each of these
more than once; this paragraph is the answer.

**If anyone later runs `epic-lifecycle` against FIX-1208, this is the thing to know first:** it
will re-derive `spec` for every child and stall the set behind gates for documents nobody needs.
Either relabel the children to a category that derives `direct`, or don't run the coordinator on
this epic. It was never built for a set whose implementation predates its epic.

### Members — completion is these

| Issue | What it delivers | Route | Kind | PR |
|---|---|---|---|---|
| [FIX-1209](https://linear.app/fixpoint-labs/issue/FIX-1209) | Superseded aliases, compat shims, unused internal barrels removed | direct | breaking minor | [#1390](https://github.com/fixpoint-labs/flow-state-dev/pull/1390) |
| [FIX-1210](https://linear.app/fixpoint-labs/issue/FIX-1210) | Options accepted but never read | direct | breaking minor | [#1387](https://github.com/fixpoint-labs/flow-state-dev/pull/1387) |
| [FIX-1211](https://linear.app/fixpoint-labs/issue/FIX-1211) | Duplicate helpers collapsed to one implementation each | direct | patch | [#1392](https://github.com/fixpoint-labs/flow-state-dev/pull/1392) |
| [FIX-1212](https://linear.app/fixpoint-labs/issue/FIX-1212) | Engine org-store factories renamed off `Project` | direct | breaking minor | [#1389](https://github.com/fixpoint-labs/flow-state-dev/pull/1389) |
| [FIX-1213](https://linear.app/fixpoint-labs/issue/FIX-1213) | Docs and agent skills stop teaching contracts that aren't on the tree | direct | docs | [#1394](https://github.com/fixpoint-labs/flow-state-dev/pull/1394) |
| [FIX-1215](https://linear.app/fixpoint-labs/issue/FIX-1215) | Scope-config `clientData` shim removed | direct | **behaviour** | [#1391](https://github.com/fixpoint-labs/flow-state-dev/pull/1391) |
| [FIX-1216](https://linear.app/fixpoint-labs/issue/FIX-1216) | Unused internal surface and truly-dead symbols removed | direct | patch | [#1395](https://github.com/fixpoint-labs/flow-state-dev/pull/1395) |
| [FIX-1217](https://linear.app/fixpoint-labs/issue/FIX-1217) | Remaining duplicate internal helpers collapsed | direct | patch | [#1396](https://github.com/fixpoint-labs/flow-state-dev/pull/1396) |
| [FIX-1220](https://linear.app/fixpoint-labs/issue/FIX-1220) | Legacy AI SDK `experimental_*` reads dropped from `createAiSdkModelResolver` | direct | **behaviour** (SDK floor) | not started — [#1400](https://github.com/fixpoint-labs/flow-state-dev/issues/1400) |

**FIX-1220 is the one member with no PR.** It was split out of #1392 during review — the two
deletions are an `ai@^7` floor decision, not a duplicate collapse, so they did not belong in a
PR whose contract was "behaviour-preserving throughout". Filed with its evidence, unstarted.
Completion waits on it like any other member.

### Satellites — related to the epic, deliberately NOT children of it

Review caught that "satellite" was decorative while these were Linear sub-issues: the epic
objective gate ramps **every** sub-issue and has no member/satellite concept, so approving §1
would have authorised them regardless of what this table said. They are now linked to FIX-1208
with `relates-to` rather than parented, which is what makes the separation real.

| Issue | What it delivers | Route | Kind | PR |
|---|---|---|---|---|
| [FIX-1155](https://linear.app/fixpoint-labs/issue/FIX-1155) | Request-scope state writes serialize before persist | direct | bugfix | [#1388](https://github.com/fixpoint-labs/flow-state-dev/pull/1388) |
| [FIX-1214](https://linear.app/fixpoint-labs/issue/FIX-1214) | State-only blocks stop echoing input into the items log | direct | behaviour | [#1393](https://github.com/fixpoint-labs/flow-state-dev/pull/1393) |

Verified in Linear rather than asserted: FIX-1155's parent is FIX-1157, FIX-1214 has no parent,
and FIX-1208's children are the nine members above and nothing else.

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
everything in Tier 3 are **not** filed here, and **cannot join this epic** — §5's third question
enumerates all twelve that remain and asks only whether they get their own epic or are dropped.

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
still open on individual PRs is review feedback, and it lives on those PRs, not here.

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

  **Why this sits here and not on #1391**, since only #1391 changes if it flips: the *question*
  is not #1391's. "How much notice does a pre-1.0 removal owe a consumer who has not read a
  changelog" is the same question the first bullet asks about names, asked about behaviour, and
  the answers have to agree — landing minors that drop names while also refusing to fail loudly
  on a removed key would be two different policies in one epic. #1391 is where the answer costs
  something concrete, which is why it is the example. If a future removal takes a different
  answer here, this stops being cross-cutting and goes to its PR.

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

- **The bloat hunt's remaining findings: their own epic later, or drop them?**

  **Joining this epic is not one of the options, and that is a change.** An earlier draft offered
  absorption as a fork, which was wrong on the same grounds that took the `bloat-hunt` row out of
  §4: it would expand an objective that has already been gated. Offering it in a smaller, counted
  box does not make it a different failure. Six of the twelve are public-name removals — the
  category §1 says needs the most careful evidence — and they deserve their own objective, not
  one approved for something else. The product owner has been told directly that Tier 2 does not
  ride along on this epic's approval.

  **The count was also doing work only a list can do.** "Thirteen candidates" is not a reviewable
  scope; nobody can check a number against §1. Twelve remain — the thirteenth, a set of stale
  `CLAUDE.md` facts, is already fixed:

  **Tier 2 — public-name removals. Evidenced, but ungated.** Each was checked against `main`:
  every one has only its declaration plus at most a re-export or a doc example telling callers to
  pass it. No read sites anywhere.

  1. `ResponseAuditorConfig.displayMode` and the `DisplayMode` type — declared at
     `packages/patterns/src/response-auditor/schemas.ts:57,65`, re-exported twice, and appearing
     once more in a JSDoc example
  2. `SessionDetail.stateSummary` — `packages/client/src/types/index.ts:147`, one reference total
  3. `ResponseAuditorConfig.alwaysRun`
  4. `ChatInboundEvent.matchedPattern` / `.matchedGroups`
  5. `ContextOf`'s vestigial third type parameter
  6. `ScopeResourceConfig` — declared at `packages/core/src/types/flow.ts:27`, re-exported at
     `types/index.ts:74`, and read nowhere

  **Tier 3 — internal surface and scaffolding.**

  7. The `resource.content.*` user-stream event family
  8. Six engine store factories re-exported but absent from the public entry
  9. Residual BP-012 `outputSchema` on `.tap()`-wired handlers
  10. `labs/trading-desk/lib/providers/fmp.ts` scaffolding
  11. Three unreferenced kitchen-sink `components/flow-state/` components
  12. ~30 symbols exported but consumed only within their own file

  **One of these is a product question and must not be decided as cleanup.** Item 7 is a feature
  built to the edge of being real and then never switched on: `ResourceContentUpdatedEvent`,
  `ResourceContentCreatedEvent` and `ResourceContentDeletedEvent` are declared in
  `packages/contracts/src/items/events.ts:131-157`, folded into the public event union at
  `:217-219`, re-exported from both `contracts` and `client`, and given three client callbacks —
  `onResourceContentUpdated` / `Created` / `Deleted` at `packages/client/src/types/index.ts:603-605`.
  Nothing constructs or dispatches any of them. Deleting it and finishing it are both defensible,
  and which one is right is a decision about the product, not about leftovers. It should not ride
  into a cleanup epic in either direction.

  **The trade being accepted:** a separate epic pays a re-familiarisation cost later and needs a
  second objective gate. Dropping them entirely costs nothing now and leaves twelve known
  untruths on the tree indefinitely, which is the state §1 exists to object to. Keeping this set
  closable is worth more than finishing the sweep in one pass.

  *Recommendation: their own epic, and not immediately.* Ten open PRs plus an unstarted ninth
  member is already more than this set can carry, and Tier 2's evidence bar deserves an objective
  written for it.

  **What would change the recommendation:** if these concentrated in the files this set already
  touches, doing them separately would mean paying the rebase tax twice. On the recomputed
  numbers that argument is weak — the overlap in this set is 28 prose files against 6 barrels,
  and Tier 2 is type and config declarations, which is not where the collisions are.

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
- **Ten PRs opened** — eight members and two satellites, every one ready for review rather than
  draft so the automated reviewers engage. The set that replaces #1369's single 266-file change is
  now on the board; #1369 itself can be closed as superseded. (A ninth member, FIX-1220, was added
  later and has no PR — see below.)
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
- **~~Merge order acquired its first hard constraint~~ — retracted, the constraint was fictional.**
  A previous round added a hard gate: #1394 (docs) must not merge before #1387 (unread options),
  because #1394's CLI page was said to describe `--seed-user` / `--seed-org` as accepted-but-inert
  and being removed. Checked against #1394's actual diff, it says nothing of the kind — it deletes
  the two flag rows and states *"Session is the only scope you can seed"*, which is already true
  on `main`, where both flags are only echoed into the `--capture` payload and never reach a
  store. Both merge orders publish a true page. The gate was derived from this document's own
  prose rather than from the branch, which is the same failure that produced the `/cli` false
  positive. The set is order-independent again; theme 6 keeps only its soft order. A follow-up
  round then established the other half: #1387 removes the flag rows from the docs as well as the
  options from the CLI, so the #1387-first order leaves docs, `--help` and code all agreeing.
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
- **Live PR state taken back out of the index** — the refresh above was the wrong instrument, and
  the evidence is that it was stale twice the same afternoon. Heads, CI, thread counts and
  readiness change hourly; a committed file cannot track them and reads as guidance while it
  drifts. The index now carries handles only. A reader deciding what to merge asks GitHub.
- **A ninth member surfaced** — FIX-1220, split out of #1392's review, was parented to FIX-1208 at
  19:09 and was missing from an index snapshotted at 19:05. Added. It is the one member with no PR
  yet, which also settles a reviewer's structural objection in the honest direction: the claim
  that every child already exists as a reviewable diff was true when written and is not true now.
- **Fixed FIX-1210's Linear title**, which still promised "retire the `claude --remote`
  experiment" after this document had dropped that cut. Verified first that no cleanup branch
  touches `packages/claude-code` at all, so the tracker was the only place the retired promise
  survived — a lying surface inside the epic against lying surfaces.
- **The overlap inventory was wrong on both the count and the characterisation** — it said 29
  files, all barrels and index files. Recomputed against all ten PR heads: **45** files are
  touched by more than one PR, and they are **28 documentation and prose, 10 source, 6 barrel or
  index, 1 test**. The rebase tax is a docs tax. That strengthens docs-last rather than weakening
  it — #1394 collides with 26 of the 45 and every one is prose, so it is the PR that gets
  re-conflicted by everything else rather than the one others rebase around. It also reorders the
  rest: the barrel-heaviest PR is #1392, a *patch*, holding five of the six shared barrels, where
  the old order put the breaking slices first on the belief that they were the barrel-heavy ones.
  Two collateral corrections: #1391 touches 15 shared files, not "almost nothing", and #1393
  touches none.
- **"Join this epic" removed as an option for the bloat hunt's remainder.** Offering absorption
  as a fork reintroduced, in a smaller box, exactly what §5 had already resolved: expanding an
  objective that has been gated. The fork is now their own epic later, or drop them. The twelve
  remaining candidates are enumerated in §5 rather than counted, because a count cannot be
  checked against §1 by anyone — and the thirteenth was already fixed. Tier 2 is evidenced (each
  item has a declaration, at most a re-export, and no read site) but ungated, which is precisely
  why it needs an objective of its own.
- **One Tier-3 item flagged as a product question, not a cleanup one** — the `resource.content.*`
  event family is declared, folded into the public event union, re-exported from `contracts` and
  `client`, and given three client callbacks, and nothing anywhere emits or dispatches it. It is
  a feature built to the edge of being real and never switched on. Delete or finish is the
  owner's call; a cleanup epic must not decide it by default in either direction.
