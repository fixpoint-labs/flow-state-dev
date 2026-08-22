# Epic — Remove superseded leftovers

## 1. Purpose & objective *(the gated sign-off surface)*

**Objective.** Make the framework's surface tell the truth about itself. Today a developer
who copies an example from our docs can hit code that fails typecheck, or pass an option
that is accepted, typed, and then silently ignored. Both cost the same thing: the developer
trusts the surface, the surface lies, and they lose an afternoon finding out. When this epic
lands, every name the framework exposes either does what its docs say or is gone.

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

**Proof.** For each cut: the grep that shows no live referent, or the successor that
supersedes the removed name. For each dead knob: the read that does not exist. Cuts land with
their evidence in the PR body, not as an assertion.

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

2. **One cut kind per PR.** The original pass was a single 266-file PR; automated review
   refused it outright at a 100-file limit, and a human could not have told a rename from a
   behaviour change inside it. Each sub-PR carries one *kind* of cut so its review question
   is a single question. This is why the set exists at all — it is not six PRs for
   bookkeeping, it is six because there are six distinct questions.

3. **Evidence travels with the cut, in the PR that makes it.** A removal's justification is
   the grep or the successor, and it belongs in the body of the PR a reviewer is reading —
   not in this document, and not in a comment on the original PR.

4. **Public-name removals are pre-1.0 minors and carry a changeset.** Being wrong costs a
   minor bump and a one-line rename for an out-of-repo caller. That price is what makes these
   decidable at engineering altitude; a cut whose blast radius exceeds it escalates.

5. **Sequencing: the six are independent and may merge in any order.** They are all based on
   `main`, not stacked. Twenty-nine files are touched by more than one slice — all barrel and
   index files — so whichever merges second may need a trivial rebase. No slice blocks
   another, and none should be held for another.

6. **The bugfix is not a cleanup and is not reviewed as one.** FIX-1155 rides in this set only
   because it was trapped in the original PR. It changes runtime behaviour, it carries its own
   regression test, and it gets its own PR so that a reviewer reading a cleanup never has to
   notice a semantic change hiding in it.

## 4. Running index

| Slice | What it delivers | Kind | PR | State |
|---|---|---|---|---|
| docs | Docs and agent skills stop teaching contracts that aren't on the tree | docs | — | Pending |
| aliases | Superseded aliases, compat shims, unused internal barrels removed | breaking minor | — | Pending |
| unread-options | Options accepted but never read, plus the retired `claude --remote` experiment | breaking minor | — | Pending |
| internal-duplicates | Duplicate helpers collapsed to one; BP-012 tap fixes | patch | — | Pending |
| org-store-rename | Engine org-store factories renamed off `Project` | breaking minor | — | Pending |
| FIX-1155 | Request-scope state writes serialize before persist | **bugfix** | — | Pending |
| bloat-hunt | Further cuts found beyond the original pass | TBD | — | In progress |

Supersedes [#1369](https://github.com/fixpoint-labs/flow-state-dev/pull/1369), which carried
all of the above as one 266-file change.

## 5. Open cross-cutting questions

- **Do we land the pre-1.0 minors that drop leftover public names?** Raised by the original
  PR, and the one question its author flagged for sign-off. There are zero in-repo production
  callers for any replaced name. *Recommendation: yes.* Being wrong costs a minor version bump
  and a one-line rename or import change for an out-of-repo caller still on an old name — which
  is the price theme 4 sets as decidable at engineering altitude. Surfaced here as the durable
  record; the merge gate on each breaking sub-PR is where it is actually answered.

- **Does the continued bloat hunt get its own epic?** The original pass was scoped to what
  could be proved from the tree in one sitting. The follow-on hunt is open-ended by nature. If
  its findings exceed what one PR can carry, the set grows rather than one PR growing — the
  same reason theme 2 exists. Blocks nothing.

---

## Epic evolution

- **Epic drafted** — split PR #1369's 266 files into six sub-PRs, one per cut kind, because
  automated review refused the original at a 100-file limit and the set contained a bugfix,
  a rename, and a docs pass that a single review question could not cover.
- **Scope extended** — added a continued hunt for stale and over-engineered code beyond the
  original pass, bounded by the same product rule, because the original stopped at what it
  could prove in one sitting rather than at what exists.
