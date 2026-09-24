# Cycle 16 — workforce plane isolation epic wrap (FIX-1528) (2026-09-24)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**Every direction artifact converged in one round, and the rework that remains sits in two
places: a general rule stated elsewhere that the change narrowed, and a claim written ahead of its
evidence.** The epic PR, its amendment and the one issue spec each spent a single wave, against ~9
and ~4 for cycle 15's direction artifacts. Read that with its population: this epic-spec was
written after most of its set had shipped (*"most of it has shipped"*, #2103's body), so it was
settling three remaining doors, not a whole direction. It is not yet a trend.

**Method — scope.** Twelve artifacts, all merged: the epic PR #2103, its follow-up amendment #2126,
the explore #2070 (FIX-1522), the issue spec #2121 (FIX-1538), and eight implementation PRs — #2091
(FIX-1529, authored by a Cursor agent), #2106 (FIX-1534), #2108 (FIX-1535), #2104 (FIX-1536), #2116
(FIX-1542), #2118 (FIX-1541), #2127 (FIX-1538) and #2109 (docs). Every review thread, every review
body and every PR's commit list was read, through the GitHub MCP. Conversation comments were read
for #2091, #2103, #2108, #2126 and #2127. Linear was read over GraphQL for FIX-1503, FIX-1545 and a
search for follow-ups of #2091's open threads. **Findings and endpoints** follow cycle 15's written
rule (*Method — findings*, *Method — endpoints*) unchanged. Direction artifacts end at merge, because
no human direction approval is recorded apart from it on any of the three. **Rounds** are spent
waves (cycle 12's definition), and every count here is **derived**, from review and commit timestamps.

| PR | Kind | Rounds | Endpoint | Feedback classes (deduped) | Felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|
| [#2103](https://github.com/fixpoint-labs/flow-state-dev/pull/2103) epic-spec FIX-1528 | epic | ~1 | merge 09-23 23:58Z | missed-edge-case ×2 (1 *overclaim*: a promised "task is not claimed" outcome the claim lifecycle cannot produce; 1 *vacuous-assertion*: an org-only key passed every proof leg) · docs-miss ×1 (*overclaim*: the resolver warning was wrong under either landing order) · spec-ambiguity ×1 (the DOCS draft taught what ER-10 forbids) · nit ×4 — *8 from 8*. **Plus one echo found after merge:** `end-state.svg` kept *"today a caller names itself"* after T7 corrected the default resolver's behaviour in DOCS.md. #2126 fixed it | no | a surface sweep after T7: the figure restates the resolver claim in its own words |
| [#2126](https://github.com/fixpoint-labs/flow-state-dev/pull/2126) epic amendment | epic (amendment) | ~1 | merge 09-24 16:05Z | missed-edge-case ×1 (*overclaim*: the first narrowing of ER-5 still promised what FIX-1538 D2 does not copy) · nit ×4 — *5 from 5* | no | — the first narrowing was a defect in the fix itself. **The Architect stamp on that same head read "exactly what D1 and D2 deliver, no more and no less".** Codex found the gap 2 minutes later |
| [#2070](https://github.com/fixpoint-labs/flow-state-dev/pull/2070) explore FIX-1522 | explore | ~2 (1 substantive, 1 code-quality) | merge 09-24 16:19Z | missed-edge-case ×4 (1 *vacuous-assertion*: the D2/D3 legs drove the app flow, not the bridge they falsified) · nit ×6 — *10 from 10* | no | — every fold came with a red state named in the reply |
| [#2121](https://github.com/fixpoint-labs/flow-state-dev/pull/2121) spec FIX-1538 | spec | ~1 | merge 09-24 01:54Z | missed-edge-case ×4 (2 P1: the schedule resolver, which **refuted the POC's "bypass that fails closed" verdict**, and a copy step that would have handed seats app-wide state against D1; 2 P2: the upgrade procedure's collection keys and occupied destinations) · nit ×4 — *8 from 8* | no | the POC counted sites by grep and **attached a behavioural verdict it never ran** (BP-003, *never ran the check*) |
| [#2091](https://github.com/fixpoint-labs/flow-state-dev/pull/2091) impl FIX-1529 | impl | ~2 | merge 09-23 19:36Z | **missed-edge-case ×8** (one *vacuous-assertion*: the roster guard tested one probe key) · over-engineered ×3 (the pin stored twice, the predicate written twice, a dead export) · design-off ×1 (Workforce policy in core's generic collection API) · nit ×3 — *15 from 15 threads plus the review bodies*. **Three non-`nit` threads were still open at merge**: Codex P1 (kitchen-sink owners can't reach their own pinned seats), Bugbot's `fire` fallback, and Codex P2 on the layering. None was answered in-thread. Four Linear searches found no issue for any of them | no | **#2070's after-suite found 5 of the 8**: probes A and B before any bot, and C, C2 and D alongside Bugbot and Codex, all run against this PR's heads |
| [#2106](https://github.com/fixpoint-labs/flow-state-dev/pull/2106) impl FIX-1534 | impl | ~1 | merge 09-23 23:55Z | **stale-restatement ×1** (`authentication.md:135` still placed the internal-dispatch pin check inside execution) · nit ×3 — *4 from 4* | no | **the change moved where a rule is enforced, and the doc that states the rule was not swept.** It was the only non-`nit` finding in the PR's one spent wave |
| [#2108](https://github.com/fixpoint-labs/flow-state-dev/pull/2108) impl FIX-1535 | impl | 0 | merge 09-23 23:53Z | nit ×4 — *4 from 4*. Codex returned clean | no | — **the quietest artifact in the epic** |
| [#2104](https://github.com/fixpoint-labs/flow-state-dev/pull/2104) impl FIX-1536 | impl | ~1 | merge 09-23 23:37Z | docs-miss ×1 (no changeset for an observable change to `reloadHiredSeats`) · over-engineered ×1 (a second per-row catch; folded) · nit ×2 — *4 from 4*. **Plus one defect found after merge by #2118:** the refactor moved an owning-org mismatch out of its org's `byOrg` slice. #2118's new test was red on `main` | no | — the post-merge find is a defect in the fix itself |
| [#2116](https://github.com/fixpoint-labs/flow-state-dev/pull/2116) impl FIX-1542 | impl | ~1 | merge 09-23 23:35Z | over-engineered ×1 (a cloned hire test; the existing test **stayed green without the stamp**, which the fold fixed) · nit ×3 — *4 from 3 threads and one review body* | no | — |
| [#2118](https://github.com/fixpoint-labs/flow-state-dev/pull/2118) impl FIX-1541 | impl | ~1 | merge 09-24 16:04Z | docs-miss ×1 (a two-sentence changeset against AGENTS.md's one) · nit ×3 — *4 from 4* | no | — the coordinator's own review caught an overstated body claim about where the bad row comes from before any bot saw it (`a63e94e`) |
| [#2127](https://github.com/fixpoint-labs/flow-state-dev/pull/2127) impl FIX-1538 | impl | ~1 | merge 09-24 16:13Z | missed-edge-case ×2 (P1: another user's schedule answered 202 vs 404; P1 *vacuous-assertion*: the BR-17 test **planted a content-store row production never writes**, left open on purpose with FIX-1545 filed first) · **stale-restatement ×1** (four surfaces still stated the general `flowIsolation`/user-scope rule the change carved a seat exception from) · docs-miss ×2 (the docs taught a hand-written resolver before the helper; an unescaped key sketch) · nit ×2 — *7 from 7* | no | **same shape as #2106**, and four surfaces instead of one, one of them in a page the PR had already edited (`persistence/overview.md:282`) |
| [#2109](https://github.com/fixpoint-labs/flow-state-dev/pull/2109) docs (durable-hire limits) | docs | ~1 | merge 09-23 23:54Z | missed-edge-case ×1 (*overclaim*: the page recommended a user-owned hire that neither taught path can produce) · nit ×3 — *4 from 4* | no | — |

**Load: ~8 spent waves across the eight implementation PRs, ~1 on each of the three direction
artifacts, ~2 on the explore.** **23 non-`nit` findings on the implementation PRs, 12 of them on
#2091**, the one PR written outside this repo's lifecycle.

**Claims (looped / settled / verdicts): 0 / 0 / —, on #2103, #2126 and #2121.** One claim came
close: the POC's "fails closed" verdict on #2121. Codex refuted it in one exchange, and the author
changed the POC write-up, SPEC and PLAN in the same fold (`b37d4c6`). Implementation then found the
resolver had never worked at all, for two reasons already on `main` (FIX-1545: it read the content
store while collections write resource state, and it refused rows that carry no `orgId`).
**A verdict attached to a count is the class BP-003 already names.** One instance, recorded.

## The class this cycle adds — a narrowed rule, still stated in full elsewhere

Two implementation PRs changed a rule that another surface states as general, and Codex found the
general statement on both:

| PR | What changed | Where the old rule still stood | How it was fixed |
|---|---|---|---|
| #2106 | the pin refusal moved to the dispatch seam, before any session is minted | `docs/architecture/authentication.md:135`: *"internal dispatch checks the pin inside execution"* | one clause naming the seam refusal and keeping the execution-time error as a backstop (`3f350f1`) |
| #2127 | a pinned seat's shared user data keys per (org, person) | `state-and-scopes.md:545` (*every `flowIsolation: false` resource uses the bare id*) · `resources-and-client-data.md:55-65` and its table row · the exported `ResourceConfig.flowIsolation` JSDoc · `persistence/overview.md:282` (*user storage is global across organizations*) | one clause each naming the exception (`8335dde`) |

**Why the cycle 15 fix does not reach it.** Fix B pointed *corrections* at `issue-implement` 10.6's
word and surface sweeps, on spec review and in `polish-docs`. Neither of these was a correction. Each
was a PR's **own new behaviour**, written at Step 5C, and 5C's only sweep instruction is the
docs-writer brief's **Targets**, *"pages and READMEs that state the affected contract today"*. Both
authors read "the affected contract" as the new behaviour's contract. Architecture docs and exported
JSDoc are outside the brief entirely (*"yours, not the writer's"*), and nothing asks the implementer
to sweep them. 10.6 reaches them only once a reviewer has filed the finding, which is what happened
here, twice.

**Reachability walk.** The trigger is *the change narrows a rule stated elsewhere: a new exception,
or a new layer that enforces it*. The obligation is 10.6's word sweep on the rule's distinctive
noun, and its surface sweep. For #2106, a word sweep on `InstancePinMismatchError` or "internal
dispatch" finds `authentication.md:135`. For #2127, a word sweep on `flowIsolation` finds
`state-and-scopes.md:545`, `resources-and-client-data.md` and the core JSDoc, and one on "across
organizations" finds `persistence/overview.md:282`. That page is the one 10.6's surface-sweep line
anticipates, *"including ones in the file you are already editing"*. **Two of two**, and in both the
fold that closed the finding was this sweep run by hand.

## The recommended upstream fix — one pointer in `issue-implement` Step 5C

Add one sentence after 5C's closing paragraph (*"Architecture docs … are yours"*):

> **When the change narrows a rule stated elsewhere — a new exception, or a new layer that now
> enforces it — the old statement is a superseded claim: before review, run 10.6's word and surface
> sweeps on it, put the user-facing hits in the brief's Targets, and fix the rest yourself.**

It adds no rule text. It points an existing canonical rule at a door fix B left open. **It clears the
Step-3 gate.** *Generalizable*: any change that narrows a rule. *Grounded*: two named P2 findings on
two artifacts, each folded by this exact operation. *Not already covered*: 10.6 fires on corrections
at PR feedback, and 5C's Targets covers user pages for the new behaviour only. *Altitude*: one
pointer in a skill, the same rung as cycle 15's fix. **What would change my mind:** if the next epic
shows no instance, this is a two-PR cluster in one subsystem, and the pointer is cheap to revert.
**What being wrong costs:** one extra grep before review on changes that narrow nothing, and the
trigger names a narrowing, so most changes skip it.

**Why this and not the larger cluster.** Five review findings carry the *overclaim* label: #2103 T5
and T7, #2126 T5, #2121 T5 (the POC verdict) and #2109 T4. Two more were caught before any
reviewer: #2127's first changeset (*"and its dynamic schedules"*, `712dc22` → `78caffc`)
and #2118's body (`a63e94e`). That is the larger shape. It is BP-003's population, though, and
cycle 14 measured what another sentence there buys.

## Scoring cycle 15's fix — carried by three artifacts, and the timestamp trap reappeared

Fix B landed at `7c29203be`, 2026-09-23 20:27Z. Asked by ancestry, per reviewed head:

```
#2121  6e04e36 CARRIES · b37d4c6 CARRIES
#2126  479f519 CARRIES · bff5c46 CARRIES
#2127  78caffc CARRIES · 8335dde CARRIES      (impl — fix B does not target it)
#2103  f41f5d4 no (21:06Z) · dccd0a5 no (21:18Z)
```

**#2103's heads were authored 39 and 51 minutes after the fix landed, and neither carries it.** A
timestamp comparison would score #2103 post-fix. It is pre-fix, and so is its echo. Every other PR in
the batch is also not carried. Only direction artifacts are in fix B's population.

- **Pre-fix, #2103: 1 echo.** T7 corrected the default resolver's behaviour in DOCS.md.
  `end-state.svg` kept *"today a caller names itself"* in its visible text. #2126's author found it
  and fixed it.
- **Post-fix, #2121 and #2126: 0 factual echoes.** Each fold reply lists the surfaces it moved.
  Neither names a **word sweep** or a **surface sweep**, and one miss shows the difference.
  #2126's fold renamed "migration" to "upgrade" in EVOLUTION row 3, `ownership.svg` and the
  DECISIONS alt text, and `PLAN.md:24` still says *"the migration … the migration is most of it"*.
  A word sweep on "migration" over the spec folder hits it. A vocabulary echo, uncounted under cycle
  15's rule, and it says the sweep ran as a surface list.

**Claim 1, first reading: the echoes stopped on both carrying artifacts, and the report did not
appear.** That is two folds, which is too small to call. The next cycle should check whether sweep
reports appear by name.

**Claim 2 (fixture never reaches production's shape): a second instance, with the opposite outcome.**
#2127's BR-17 test plants a content-store row production never writes. This time the implementer
found the store mismatch while making the test pass, filed FIX-1545 at 03:00:26Z, and disclosed it
in the PR body **before** Codex's P1 on the same test at 03:05:55Z. The fixture still ships, as a
named placeholder with an owner. So there is one instance each way (#2028 missed, #2127 disclosed),
and nothing to mint.

**Claim 3 (direction rounds separable by cause):** all three direction artifacts spent one
reviewer-driven wave, with no owner-initiated round. The split had nothing to separate this cycle.

**Claim 6 (release-note class off a removal epic): below the bar.** 2 of 23 non-`nit` implementation
findings are in a changeset (#2104 T4, #2118 T4), or 9%. Counting the three changeset defects the
coordinator's own passes caught before review (#2127's bump and schedule claim, #2118's provenance
claim) gives 5 of 26, or 19%. Both are under cycle 15's 20% line, which supports the "property of the
sample" reading.

**Claims 4 and 5: no docs-polish pass in this batch.** Carry them forward.

## The coordinator's observations, checked against the artifacts

| # | Verdict |
|---|---|
| Changeset bump | **CONFIRMED.** `712dc22` wrote `"@flow-state-dev/engine": patch`, and PLAN S5 says *"One `minor` changeset for `@flow-state-dev/engine`"*. `78caffc` corrected it before the PR left draft. The same commit removed *"and its dynamic schedules"*, a second overclaim in the same fragment. |
| Changeset length (#2118) | **CONFIRMED.** Codex P2 T4 cited AGENTS.md:36-39, and `3e57d1d` joined the two sentences. |
| Two overstated bodies | **CONFIRMED on #2118**, where the merged body credits the coordinator's review with the flag and `a63e94e` with the fix. **Partly derivable on #2127**: the PR body's edit history is not in what I can read, but the changeset diff shows the schedule claim going out (`712dc22` → `78caffc`), and the merged body scopes it (*"Schedules a run creates do not resolve on `main` today … filed as FIX-1545"*). |
| False premise to the amendment agent | **CONFIRMED in outcome; the premise itself is not in the artifacts.** FIX-1503 is *In Spec Review* in Linear, so "verified by default" is not true today. #2126's `end-state.svg` now says the default *"is unverified and names no org"*. The wrong claim also stood in #2103's own figure, so the brief repeated a claim already in the spec. |
| Docs-editor REVISE | **Consistent, and derivable only on #2109**, whose body records REVISE with two findings, applied in `dc2eff8`. #2127 (`78caffc`, *"docs-editor revisions"*, then `06a2b4e`), #2106 (`c0cda03`, `ab2e32a`) and #2108 (`03f23b5`) each have docs-only revision commits before the first review. |
| Sub-agents couldn't dispatch lenses or docs agents | **NOT DERIVABLE** from PR data. The artifacts show the passes ran. They do not show who ran them. |
| FIX-1545 found late | **CONFIRMED, and sharper.** #2121's first head called the resolver *"one production bypass that fails closed (it reads the person's own cell, which no longer holds a seat's data)"*. Codex refuted "fails closed", and the fold routed the resolver into S3. Neither the POC nor the fold **ran** the resolver. The implementation did, and found it never resolved a run-created row, pinned or not. |

## Candidates considered and dropped

- **Sharpening BP-003 for the overclaim cluster.** Dropped. It is seven instances and the class
  BP-003 already owns. Cycle 14 measured the yield of another sentence there.
- **A rule that a POC's verdict may not exceed what it ran.** Dropped at one instance (#2121). It is
  tenet 7 and BP-003's *never ran the check*.
- **An `epic-lifecycle` line that dispatch briefs cite the spec instead of restating it.** Dropped
  at two instances, both from one coordinator in one epic: the patch bump and the FIX-1503 premise.
  Carried as claim 3 below.
- **Anything for #2091.** Dropped. A Cursor agent wrote it outside `issue-implement`, so no skill in
  this repo was on its path. Its cheapest catches came from #2070's after-suite, which ran the
  explore's probes against its heads and found probes A, B, C2 and D. That is `spec-poc` working as
  written.

## Filed, not proposed

- **#2091 merged with three non-`nit` threads open and unanswered**: Codex P1 (kitchen-sink's
  pinned seats unreachable by their owners without a host resolver), Bugbot's `fire` fallback, and
  Codex P2 (Workforce policy in core's generic collection API). Four Linear searches found no issue
  for any of them. This is the second merge over an open P1 after cycle 15's #1391. #1391 was on a
  path 10.6 governs, and this one was not, so it is recorded as a second instance of the event, not
  of the same failure.
- **#2104's reload refactor dropped an owning-org mismatch from its org's `byOrg` slice.** #2118
  restored it, with a test that was red on `main`. A defect in the fix, found by a sibling PR in the
  same epic.

## Claims to test next cycle

1. **Does 5C's pointer stop a narrowed rule surviving elsewhere?** Baseline: 2 of 8 implementation
   PRs, both caught by Codex P2. Score the next epic's implementation PRs for stale-restatement of
   a general rule, and check the PR records the sweep.
2. **Do fix B's sweep reports appear by name?** Two carrying folds had no factual echoes and no
   named report, and one vocabulary echo a word sweep would have found. Check the next two direction
   artifacts.
3. **Do coordinator dispatch briefs carry facts the spec owns?** Two this epic: one caught by the
   sub-agent (the FIX-1503 premise) and one that shipped to a draft and was caught by review (the
   bump). If the next epic shows a third, the home is one line in `epic-lifecycle`'s dispatch step.
4. **Is one round per direction artifact the new normal, or this epic's population?** The epic
   spec was written after most of its set shipped. The next epic whose spec opens before its
   children is the comparison.

## Finding map

`T`-numbers are positions in each PR's review-thread list, oldest first. `+` joins threads collapsed
into one finding.

- **#2103** mee ×2: T5 · T6. docs-miss ×1: T7. spec-ambiguity ×1: T8. nit ×4: T1–T4. Echo after merge:
  `end-state.svg:73`.
- **#2126** mee ×1: T5 (defect in the fix itself). nit ×4: T1–T4.
- **#2070** mee ×4: T6 · T7 · T8 · T9. nit ×6: T1–T5 · T10.
- **#2121** mee ×4: T5 · T6 · T7 · T8. nit ×4: T1–T4.
- **#2091** mee ×8: T1 · T2 (+ Architect C) · T3 (open) · T12 · T13 (open) · T14 · Architect A · Architect B.
  design-off ×1: T4+T9+T15 (open). over-engineered ×3: T5 · T7 · T8+T11. nit ×3: T6 · T10 · the #2070
  author's "Unknown flow" string-match note.
- **#2106** stale-restatement ×1: T4. nit ×3: T1–T3.
- **#2108** nit ×4: T1–T4.
- **#2104** docs-miss ×1: T4. over-engineered ×1: T3. nit ×2: T1 · T2. After merge: the `byOrg` regression
  (#2118).
- **#2116** over-engineered ×1: the Code Snob review body. nit ×3: T1–T3.
- **#2118** docs-miss ×1: T4. nit ×3: T1–T3.
- **#2127** mee ×2: T5 (open, FIX-1545) · T6. stale-restatement ×1: T7. docs-miss ×2: T3 · T4. nit ×2: T1 · T2.
- **#2109** mee ×1: T4. nit ×3: T1–T3.

**Implementation non-`nit`:** 12 + 1 + 0 + 2 + 1 + 1 + 5 + 1 = **23**. In a changeset: #2104 T4,
#2118 T4 = **2**.
