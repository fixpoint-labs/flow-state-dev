# Cycle 10 — W3 file-convention epic, mid-flight (FIX-1351) (2026-09-16)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**Periodic run, not an epic wrap.** FIX-1351 is 5 of 13 done, so every endpoint below
falls back to **collection time** and the epic row is a **partial**. Nine artifacts, plus
the FIX-1370 rescue, which is not W3 work but is this cycle's most expensive incident.

| PR | Kind | Rounds | Endpoint | Feedback classes | Claims l/s | Felt off? | Upstream fix that would have prevented it |
|---|---|---|---|---|---|---|---|
| [#1718](https://github.com/fixpoint-labs/flow-state-dev/pull/1718) epic-spec | epic | **2 (in flight)** | collection | over-engineered ×2 · nit | 0 / 0 | no | — |
| [#1711](https://github.com/fixpoint-labs/flow-state-dev/pull/1711) spec FIX-1352 | spec | 2 | approval | missed-edge-case ×3 · over-engineered ×2 · **docs-miss (deferred `apps/docs` page)** · nit ×2 | 0 / 0 | no | A spec may not defer the docs page for a surface a *user writes* |
| [#1715](https://github.com/fixpoint-labs/flow-state-dev/pull/1715) spec FIX-1354 | spec | 2 | approval | missed-edge-case ×2 · over-engineered ×2 · **docs-miss (same deferral)** · nit | 0 / 0 | no | Same — second instance, same sentence |
| [#1738](https://github.com/fixpoint-labs/flow-state-dev/pull/1738) spec FIX-1311 | spec | 2 | approval | design-off (identity reshape) · missed-edge-case ×2 · stale-restatement · nit ×2 | 0 / 0 | **yes** — one kind = one instance, settled by owner lock | — |
| [#1747](https://github.com/fixpoint-labs/flow-state-dev/pull/1747) impl FIX-1311 | impl | 4 | merge | **missed-edge-case ×3 (High: permanent unbindable channel)** · docs-miss ×2 · over-engineered ×2 · nit | 0 / 0 | no | BP-035's interaction clause — both halves were proved correct *separately in the same run* |
| [#1737](https://github.com/fixpoint-labs/flow-state-dev/pull/1737) impl FIX-1354 | impl | 3 | merge | **docs-miss ×2 (PR body claimed "no `apps/docs` page" — false; and a test count that was unrecoverable, not stale)** · over-engineered ×2 (declined, both correct defects/wrong remedies) · nit | 0 / 0 | no | A PR body's *state claims* carry BP-003's burden |
| [#1793](https://github.com/fixpoint-labs/flow-state-dev/pull/1793) impl FIX-1352 | impl | 3 | merge | **docs-miss ×5** (Codex P1 no docs-site page · 4 editorial, incl. a section contradicting its own page) · **missed-edge-case ×2 (two tests that could not fail)** · over-engineered ×4 (declined → FIX-1389) · nit ×2 | 0 / 0 | no | — (BP-003's red-state clause caught both vacuous tests; see *What fired*) |
| [#1797](https://github.com/fixpoint-labs/flow-state-dev/pull/1797) impl FIX-1370 rescue | impl | 3 | merge | **missed-edge-case (Codex P2: unterminated frontmatter silently drops all agent config)** · over-engineered ×4 (declined → FIX-1406) | 0 / 0 | no | — |
| [#1735](https://github.com/fixpoint-labs/flow-state-dev/pull/1735) impl FIX-1370 (orig) | impl | 4 | merge | — (reviewed and approved; the defect is **where it merged**) | 0 / 0 | no | **Base-branch check at PR open: a PR based on a non-default branch names why** |

## The instrument has a hole this cycle found in itself

**An agent's PR replies are indistinguishable from the owner's in the API.** This session's
replies post under `jhoffner` (the session's token is the owner's). The API reports 5
`jhoffner` reviews on #1793 and 5 on #1797 — **all of them mine**. Cycle 9's row header
counts "the owner's Architect pass" as a reviewer signal, so a collector that trusts the
author field will read agent replies as independent owner review and inflate both the round
count and the apparent human-review coverage. The only reliable discriminator is the
attribution footer in the body. **Any future ledger row must exclude footer-bearing
`jhoffner` comments from reviewer passes**; the rows above already do.

## Scoring cycle 9's fixes — neither was ever written

Checked on `main` rather than assumed:

- **Fix A (BP-003 sharpened to cover guarantee sentences): absent.** BP-003 carries its
  hardened red-state clause (landed earlier, `#1693`) and nothing about a guarantee sentence
  naming its enforcement point.
- **Fix B (`get_reviews` required in the PR-feedback loop): absent.** `issue-lifecycle`'s
  `get_reviews` references are the pre-existing *spec-approval* read. Zero hits repo-wide for
  the subscription-race rationale.

**Third consecutive cycle where the previous cycle's fixes could not be scored** — cycle 8's
were carried by 2 of 15 branches, cycle 9's were proposed-pending-gate, cycle 10's are
unwritten. Separately, the one commit that *did* touch `issue-lifecycle` today (`b6fcf355c`,
18:15Z) is carried by **none** of this cycle's four implementation branches, all of which
forked earlier. **The loop's fixes keep landing after the work that would test them.** That is
a structural property of proposing at wrap and gating afterwards, not an accident of any one
cycle, and it is the finding with the widest blast radius here: an instrument whose
corrections are never scoreable cannot tell a good fix from a dead one.

## The dominant class — overclaim, third cycle, and it has left prose

Cycle 9 named it in prose: *a sentence asserting a guarantee with no named enforcement point*.
Cycle 10's instances are the same shape on surfaces cycle 9 didn't sample:

- **A tracking record claiming a state the repo does not have.** FIX-1370 sat **Done** for four
  days with `agent-prompt-file.ts` absent from `main` — its PR merged into a branch whose own
  PR had already merged, so the code had no route anywhere. FIX-1344 was **Done by
  inheritance** off it. GitHub said merged; Linear said Done; both were locally true and
  jointly false. Cost: one rescue PR, and four days in which anyone extending agent prompt
  files would have built on a feature that wasn't there.
- **A PR body claiming a verification state.** #1737 asserted "no `apps/docs` page, per the
  spec's §11" — false, the page shipped — and a test count that `main` had made
  *unrecoverable* rather than merely stale.
- **A spec deferring a user-facing surface on a rule that has now lost twice.** #1715 §11 and
  #1711 both wrote the docs page off as belonging "with the first consumer". Both were
  overruled — once by a broken relative link, once by a Codex P1 citing AGENTS.md. **A file
  convention a user can write is the first consumer.**

Every instance is a claim with no enforcement point. The class did not resist cycle 9's fix;
**cycle 9's fix was never applied.**

## What fired — BP-003's red-state clause, scored as a win

The one landed fix this cycle can score. On #1793 the implementer removed each of eleven
guards in turn and required a red state. **Two came back green:** a spec covering a
*symlinked* `CHANNEL.md` but not an *unreadable* one (deleting that branch fell through to
"no CHANNEL.md" — a live wrong-answer bug telling an author to write a file already present),
and an `IGNORED_ENTRIES` spec written against a dropping that was a *file*, where the slot
rule already skips files, so it discriminated nothing. Both would have shipped as tests
incapable of failing. **This is BP-003's hardened clause doing exactly what it was sharpened
for**, on a branch that carried it — the first cleanly scoreable fix success in three cycles.

Worth noting the same discipline caught its own near-miss later: the #1797 guard needed *two*
specs, because the obvious check ("first line is `---`") would refuse an empty-but-closed
fence. One red test proves a check catches the bug; the pair proves it catches the bug
**without over-refusing**.

## Findings recorded, not fixed

- **A restraint lens is the wrong instrument for a missing artefact.** Cursor's Code Snob filed
  "no docs-site page" under *not re-litigating* on #1793. It hunts excess, not absence. Its
  silence was briefly read as evidence; it isn't.
- **Isolation earned its keep twice on one PR.** `docs-writer`, given a surface brief and no
  diff, repaired a doc the change had silently invalidated (`workers-on-disk.md`'s
  passed-over-in-silence list, stale the moment a fourth reader existed) — found by running the
  loader test, not by reading the diff. `docs-editor` then caught the new section telling
  readers a file can "open a channel" seventy lines above a section explaining that it cannot.
  Neither was visible to the implementer, three review bots, or the coordinator.
- **A brief can defeat the isolation it pays for.** The first `docs-editor` dispatch described
  an implementation seam; the agent declined the framing and judged from the text, and said so.
  The second carried no implementation facts. Brief the isolated reader on what a reader should
  come away with, never on the shape of the code.
- **Codex: ~23 findings across the cycle, zero rejected.** Every one verified real, including
  two P1s and the P2 above. Cursor's two lenses: both clean or approving on both PRs they ran,
  with every suggestion correctly non-blocking.
- **`settle-claim`'s front door: zero invocations again.** Third cycle. No claim looped twice
  this cycle, so the skill had no trigger — genuinely nothing to fire on, unlike cycles 8 and 9
  where settlements happened by other means.
- **Escape sweep still not run.** Three cycles deferred.

## Claims to test next cycle

1. **Land fixes at the gate, not after it.** The single change most likely to make cycle 12
   scoreable is writing an approved fix *immediately*, before the next epic's branches fork.
   (Renumbered: this named *cycle 11* before the back-dated FIX-980 entry took that number.)
   Baseline: three cycles, zero scoreable corrections.
2. **Does an enforcement-point clause cut overclaim once it actually exists?** Cycle 9's
   baseline stands unchallenged at ~30% of non-`nit` findings; cycle 10's share is ~35%
   (8 of 23 non-`nit`). Neither number has ever been measured against the fix.
3. **Does a `main`-existence check before Done stop the false-Done class?** Baseline: two
   false Dones this cycle (FIX-1370, FIX-1344), four days undetected, one rescue PR.
4. **Exclude footer-bearing `jhoffner` comments from reviewer passes** in every future row, and
   re-read cycle 9's counts with that filter before comparing them to anything.
