# Cycle 8 — durable-storage-symmetry epic wrap (FIX-1157) (2026-08-28)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**Numbered after cycle 7 although this epic wrapped before it.** The two runs measured different epics independently and landed out of order. Everything below was computed against cycles 1–6: cycle 7's PRs are not in this sample. That is why this entry scores cycle 6's claims rather than cycle 7's, and why the `stale-restatement` count runs through cycle 6 only — cycle 7 recorded that class on three of its PRs but selected a different one.

FIX-1154, FIX-1258, FIX-1260, FIX-1269 under epic FIX-1157, plus the FIX-1158 lodger (#1444,
merged earlier). **Four implementation PRs merged**, two spec PRs closed unmerged (BP-037), one
epic PR closed unmerged at the wrap. ~154 review threads across `chatgpt-codex-connector[bot]`,
`cursor[bot]`, `greptile-apps[bot]`, `github-code-quality[bot]` and the implementing agents.

**All four impl PRs merged, so escapes are scoreable for the first time since cycle 5** — cycle 6's
claim 1 becoming measurable. **This entry did not run the post-merge escape sweep**; the column is
**unmeasured, not zero**. Do not read it as an improvement.

| PR | Kind | Rounds | Endpoint | Feedback classes | Claims l/s/verdicts | Felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|---|
| [#1487](https://github.com/fixpoint-labs/flow-state-dev/pull/1487) FIX-1258 | impl | **5** | merge | `missed-edge-case` ×7 · `stale-restatement` ×5 · `docs-miss` ×1 · `nit` ×5 | 1 / 0 / deferred | no | Enumerate every *writer* of the record a new invariant depends on before the first commit — three session-birth sites and a fourth in the test harness were found one at a time across three rounds |
| [#1488](https://github.com/fixpoint-labs/flow-state-dev/pull/1488) FIX-1269 | impl | **4** | merge | `missed-edge-case` ×3 · `stale-restatement` ×3 · `over-engineered` ×5 (all declined with reasons) · `docs-miss` ×1 · `nit` ×3 | 1 / 1 / **CONFIRMED** | no | When a change adds a verb to a surface, derive the set of surfaces that *enumerate* it once, from code |
| [#1486](https://github.com/fixpoint-labs/flow-state-dev/pull/1486) FIX-1260 | impl | **5** | merge | `missed-edge-case` ×5 · `stale-restatement` ×6 · `over-engineered` ×2 (both taken) · `docs-miss` ×3 (owed, unlanded) · `nit` ×1 | 1 / 2 / **CONFIRMED** ×2 | no | Correct the **generator** first — the guard's own docstring, which all three doc copies derived from, was corrected a round *after* them |
| [#1478](https://github.com/fixpoint-labs/flow-state-dev/pull/1478) FIX-1154 | impl | **≈16** | merge | `missed-edge-case` ×24 · `stale-restatement` ×7 instances / 12 copies · `over-engineered` ×5 (4 taken) · `spec-ambiguity` ×1 · `docs-miss` ×1 · `nit` ×1 | 2 / 2 / **CONFIRMED** ×2 | **yes** — "direction right, delivery over-scoped"; 4 files → 20 | BP-035 applied to *sentences*: the 24 edge cases are one shape — a prose guarantee that fails on a second path |
| [#1365](https://github.com/fixpoint-labs/flow-state-dev/pull/1365) FIX-1157 | **epic** | **≈27** post-gate (gate at 4, a marker) | epic close | `over-engineered` ×14 · `stale-restatement` ×8 · `missed-edge-case` ×8 · `spec-ambiguity` ×3 · `design-off` ×2 | 4 / 3 / **CONFIRMED** ×3 | **yes, twice** | §4 is a projection of the Linear graph; it was used as a status board an agent rewrites on every child event. Six reviewer findings, six regressions — this wants mechanism |
| [#1445](https://github.com/fixpoint-labs/flow-state-dev/pull/1445) FIX-1154 | spec | **35** | approval | `missed-edge-case` ×~14 · `stale-restatement` ×6 · `spec-ambiguity` ×3 · `design-off` ×2 · `over-engineered` ×2 | 5 / 5 / **CONFIRMED** ×4, **REFUTED** ×2 | **yes** — owner reversed the subject mid-review | A spec's factual base gets one executable checker at round 1, not round 20 |
| [#1479](https://github.com/fixpoint-labs/flow-state-dev/pull/1479) FIX-1269 | spec | **2** | approval | `missed-edge-case` ×3 · `docs-miss` ×1 · `nit` ×5 | 0 / 2 / **REFUTED** ×2 | no | **nothing — this is the control row** |

**Process load sits on direction artifacts: 30 rounds across four impl PRs, 64 across three
direction artifacts.** The two-round budget held on exactly one of the three — the one that built
its POC *before* review and had a moderator enforcing the altitude bar.

## Scoring cycle 6's claims

1. **Escapes, now scoreable — not scored.** All four impl PRs merged. Recorded as unmeasured; the
   next cycle inherits it.
2. **`wrong-extent` by round-gap — not scored, and deliberately.** Cycle 6's sample was the
   Conductor subsystem and its deliverables *were* checks that grade a run; this cycle is an
   unrelated subsystem. Scoring the class across that boundary would measure the subject, not the loop.
3. **"Whether a reviewer stopped running" — fires, and it is the finding cycle 6 predicted.**
   **Codex is the only reviewer that re-reviews.** Cursor (both personas), Greptile and
   github-code-quality each ran **exactly once per PR, on or near the opening head, and never
   returned** — verified across all seven artifacts. **Consequence: the `over-engineered` /
   restraint class is measured only against each PR's first revision.** #1488 says so in its own
   description — *"Cursor approved this at the smaller scope… That approval predates roughly half
   the diff."* Any reading that restraint improved this cycle is an artifact of when the restraint
   reviewer looked. **Bots were absent from the merge head on 5 of 5 artifacts** (#1487 merged 3
   commits past its last bot pass, #1486 and #1478 by 2, #1488 and #1479 by 1).

## The class selected: `stale-restatement`, fourth cycle running — and why the existing fix does not fire

**37 instances.** Named in cycle 2, selected in cycle 4, called "the only class that escapes review"
in cycle 5. Cycle 4's fix A — *grep the superseded claim's distinctive noun* — landed in `b0fc019`
and, verified by **branch-head ancestry** (not merge commits, not timestamps), was carried by
**#1488, #1486 and #1478**.

**The hypothesis this wrap started with was refuted.** The coordinator predicted most instances were
authored outside `issue-implement`'s reach. They were not: **22 of 37 (59%) were inside the loop
where the rule can fire.** Two sharper cuts came out of the attribution instead:

1. **The rule converged 22 and prevented 0** — and **fired one round late on the generator twice**
   (#1486's guard docstring, the source three corrected copies derived from; #1488's internal twin
   of a published enumeration). Its text points **downstream** at copies: *grep the noun*, *sweep
   every surface that states the claim more briefly*. Nothing in it says *correct the surface the
   copies were derived from first*. #1478 names this failure mode in its own description — an agent
   *"independently reproduced the over-broad framing, having derived it from the docstring, before
   the correction reached it"* — and reproduced it inside itself.
2. **All 15 out-of-reach instances are on direction artifacts. Zero on an impl PR.** Eight on the
   epic PR, seven on spec PRs. **And they are the ones that recurred** — one twice, one class three
   times across the epic, the epic description through four superseded patch-lists. In-loop
   instances converged in a round or two because *something closes a round*. **Nothing closes a
   round on an epic doc or a spec document.**

**Cycle 6's central finding is confirmed first-party, at a new altitude.** Cycle 6: *"writing a rule
down did not deter the author who had just diagnosed the class."* This cycle the **coordinator**
named the class ~13 times in its own working notes and then committed it twice — once fixing the
engine README and leaving its published twin, once authoring a brief whose phrasing put a false
coupling into the very paragraph written to remove a false constraint. Different altitude, same
result. **A seventh sentence is still not the fix; a rule pointing the wrong way is a different
defect, and worth correcting on its own terms.**

## Upstream fixes — landed

| # | Fix | Altitude | Targets | Status |
|---|---|---|---|---|
| A | `issue-implement` 10.6's reconciliation now leads with **correct the surface the claim was derived from, before converging the copies** — the two sweeps follow it | skill, PR-feedback | the 22 in-loop instances, and the 2 that fired a round late in particular | **landed** |
| B | `issue-spec` Step 5 gains **the spec's factual base gets an executable checker before it gets a reviewer** — with a totality assertion and a **run** negative control | skill, spec pre-publish | #1445's 35 rounds; the 7 spec-PR instances | **landed** |

**A is a correction, not an addition.** The rule already existed and pointed only downstream; this
is the "sharpen the existing entry so it actually catches the class" branch, and the evidence is
self-reported by two PRs in this cycle.

**B is the mechanism half, and it is modelled on what measurably worked here.** #1445 eventually
built the checker and it fired immediately; #1479, the only artifact to hold its budget, built its
evidence first and used it to **refute the premise its issue was written on**. Both properties in the
rule are learned from failure: the totality assertion, because a checker verifying only the sites it
knows about cannot report the one nobody listed; and the **run** negative control, because the first
version of that assertion silently absorbed a planted unclassified file — *the exact failure the
assertion existed to prevent, reproduced inside it*.

**Neither fix addresses the direction-artifact round-closing gap** (finding 2 above). B reduces the
rounds; it does not give an epic doc a step at which restatements converge. Recorded as the open
half rather than papered over.

## Dropped

- **A new BP.** The class has two upstream fixes already; a third sentence is what cycle 6 ruled out.
- **A tenet sharpening.** Tenets 1 and 5 already cover coherence and fixing at the owning layer. The
  defect is that a skill rule pointed the wrong way, not that the grounding is silent.
- **`wrong-extent` carry-over** — cross-subsystem, would measure the sample.
- **The 12-round cap.** Recorded below as a finding, not fixed: this cycle would be guessing at why
  it did not fire.

## Findings recorded, not fixed

- **#1478 ran ~16 rounds against a 12-round cap that never fired** — no pause, no reset, no question
  to the owner, verified across all 31 reviews and 6 issue comments. The cap is prose in
  `issue-implement` §10.7. `#1445`'s 35 rounds were never in its scope at all: it governs the
  PR-feedback loop, not spec review.
- **`settle-claim` was used zero times, while 12 claims were settled.** All 12 went through ad-hoc
  `spec-poc/` directories, a PR verification section, or a coordinator running a predicate directly.
  The skill's *outcome* is healthy; its *front door* is unused. Probe proved non-vacuous (the same
  query returned #1493 for `POC in:title`).
- **`philosophy-drift` = 0 is "not looked for", not measured.** No reviewer this cycle ran a
  coherence-against-`philosophy.md` lens.
- **The epic PR sat open for 3 days past `Done`**, against its own written close condition, with a
  CI-red head. The wrap predicate is executable and ran; the PR-close step is prose and did not.

## Claim to test next cycle

1. **Fix A's effect is visible in *where* the correction lands, not in the count.** The prediction is
   that the generator gets corrected in the same round as its copies rather than one round later.
   **Score the round-gap between generator and copies, not the instance count.**
2. **Fix B's effect is on the direction-artifact round count.** Baseline to beat: **#1445 at 35
   rounds against a 2-round budget**, with #1479 at 2 as the control. If a spec with a counted
   factual base still runs past ten rounds on evidence accuracy, B landed at the wrong altitude.
3. **Run the escape sweep this cycle deferred**, and score `stale-restatement` escapes to `main`
   across the four merged PRs before comparing anything to cycle 5.
4. **Re-check reviewer coverage before reading any restraint trend.** Three of four reviewers ran
   once per PR at the opening head. Until that changes, `over-engineered` measures first revisions.
