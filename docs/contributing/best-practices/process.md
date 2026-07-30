# Best Practices — Process & Docs

Situational BPs for execution process, change tracking, and documentation
upkeep. Load this file when scoping a change or touching READMEs.
See [`../best-practices.md`](../best-practices.md) for the index and universal rules.

---

### BP-002: Spec-driven execution

- Status: Active
- Date: 2026-02-15 (updated 2026-06-28: spec-driven)
- Scope: Process — scoping and tracking a change.
- Rule:
  - Every implementation change maps to a tracked unit of intent. Which unit depends on the route ([`../orchestration.md`](../orchestration.md) → "Which issues get a spec"): a **feature / enhancement** gets a full `docs/specs/*` spec per BP-037; a **bug** gets none — the Linear issue is the contract and the fix is reviewed on its implementation PR.
  - Each spec carries explicit deliverables and verification steps.
  - Between the two: small, local work can use a one-screen agent brief on the issue (`agent-brief-template.md`) instead of a full spec doc. A bug returns to the spec route on the three overrides in [`../orchestration.md`](../orchestration.md) → "Which issues get a spec" — don't re-enumerate them here, since a count that drifts from the router's reads as a contradiction.
- Why: Ties every change to a reviewable unit of intent with its own acceptance criteria, so execution stays accountable to a tracked requirement.

### BP-004: Public boundary first

- Status: Active
- Date: 2026-02-15
- Scope: Process — package/architecture sequencing.
- Rule:
  - Prioritize package boundaries and contracts before runtime implementation details.
  - Lock import/export shape before behavior depth.
- Why: Settling the public surface early reduces cross-package churn and rework later.

### BP-005: Dual changelog requirement

- Status: Superseded (2026-05-19) by [BP-022: Release notes via Changesets](../best-practices.md#bp-022-release-notes-via-changesets)
- Date: 2026-02-15
- Scope: Process — release notes (historical).
- Rule (historical): a pre-Changesets changelog requirement. Its root-`changelog.md` half is superseded by BP-022 (per-package CHANGELOGs via Changesets). Retained as a numbered placeholder; consult `AGENTS.md` for any remaining process-artifact requirements.

### BP-006: Keep planning/tracking labels out of code and tests

- Status: Active
- Date: 2026-02-16 (updated 2026-06-28: generalized to all tracking labels)
- Scope: Code & test hygiene.
- Rule:
  - Don't use planning/tracking labels (milestone names, spec IDs, Linear refs) as **identifiers in code or test logic** — no variable, type, function, or test title named after a milestone or ticket.
  - A `FIX-NNN` reference is fine as a **provenance or TODO pointer in a comment** (e.g. a dual-read cleanup marker per BP-030). The ban is on labels driving code/test structure, not on citing a ticket in a comment.
- Why: Tracking labels as identifiers couple runtime artifacts to transient planning state and rot; as comment pointers they add useful provenance.

### BP-008: Keep README onboarding-first and current

- Status: Active
- Date: 2026-02-16
- Scope: Docs — root README.
- Rule:
  - `README.md` is the first-stop onboarding document: project purpose, objectives, key concepts, setup, package responsibilities, and core commands.
  - Process-specific collaboration protocol lives in `AGENTS.md`, not `README.md`.
  - Update `README.md` in the same change set when onboarding-relevant facts change (new package/app, package responsibility changes, setup/command changes, or major architecture concept shifts).
- Why: The README is the first thing a new developer reads; stale onboarding misleads from minute one.

### BP-009: Maintain package-level READMEs for public packages

- Status: Active
- Date: 2026-02-16
- Scope: Docs — package READMEs.
- Rule:
  - Maintain `README.md` in each public package directory (`packages/*`): purpose, current public API surface, basic usage, and package-local verification commands.
  - Update a package README in the same change set when that package's exported surface, runtime behavior, or setup scripts materially change.
- Why: Docs next to the code that owns each contract reduce integration friction and drift.

### BP-037: Author specs as versioned docs, reviewed as a PR, synced with Linear

- Status: Active
- Date: 2026-06-29 (updated 2026-07-28: review bar + convergence budget)
- Scope: Process — spec authoring (`issue-spec`).
- Rule:
  - Write each spec to `docs/specs/<ISSUE-ID>.md` and open a spec PR for it (separate from the implementation PR) so the project's automated reviewers critique the design before any code is written. Applies to issues **on the spec route** — a bug has no spec and no spec PR by design (BP-002).
  - Follow [`../spec-template.md`](../spec-template.md), whose every section is a worked example of that section filled in. An epic's coordination artifact follows [`../epic-spec-template.md`](../epic-spec-template.md) the same way.
  - The repo spec and the Linear spec document are the same content — keep them in sync; any edit to one mirrors to the other in the same change.
  - The spec PR is never merged: `issue-implement` closes it (unmerged, branch deleted) when implementation starts. Review history stays on the closed PR; the Linear document is the durable copy from then on. Merging would accumulate point-in-time spec docs on main that go stale as implementation deviates.
- Why: Reviewing the spec before implementation catches design problems when they're cheapest to fix — a doc edit, not a code rewrite.

### BP-040: Spec review is a direction check — converge, don't grind

- Status: Active
- Date: 2026-07-28
- Scope: Process — spec-PR review (`issue-spec` Step 6.5, `issue-lifecycle`, `epic-lifecycle`).
- Rule:
  - **Sign-off certifies directional correctness only** — the problem is real, the approach works, Part I's Decisions are the ones we want. Not a finished design, and not "nothing left to nitpick" (an unreachable target).
  - **One test per comment: does acting on it change the approach?** Yes → **fold in** (re-draft, anti-addenda rule). No → **note for the implementer** (record verbatim in the spec's §13; reply once; do *not* rewrite the design prose around it). Already answered / out of scope / preference → **drop** with one reply. **Default is note; the burden of proof is on folding.**
  - **Budget two review rounds**, then declare convergence and go to the approval gate, carrying remaining threads as §13 notes. A third round requires a genuine spec-level finding from round two, stated in one line. Count rounds **actually spent** — a factual-correction-only batch costs zero — and keep the conditional third round reachable rather than stopping on the count alone. The same budget applies to an **epic** PR.
  - **Don't drive spec-PR threads to zero.** The spec PR is never merged, so open threads gate nothing. A bot `CHANGES_REQUESTED` neither trips the gate nor extends the budget.
  - **Below-the-bar spec comments never block implementation** — they're implementer input, not prerequisites.
  - The spec PR description leads with the reviewer contract from `spec-template.md` (what's in scope to challenge, what's deliberately unsettled) — the one lever available on reviewers we can't instruct.
- Why: Spec-PR review comes mostly from automated reviewers tuned for code, pointed at a document that is deliberately not a finished design. Treating every line-level observation as a spec defect turned directionally-sound specs into ten-round grinds, at the altitude where none of that detail can actually be settled. Full rule, with the rationale for why converging is safe: [`../orchestration.md`](../orchestration.md) → "Spec review: the bar and the convergence rule".

### BP-039: Specs lead with a plain-language summary

- Status: Active
- Date: 2026-06-29
- Scope: Process — spec authoring (`issue-spec`).
- Rule:
  - Begin every spec with a 2–4 sentence plain-language summary of the *solution* — what we're doing and why, in terms a multitasking or non-expert reader can grok without the framework vocabulary (no file paths, type names, or block/capability/scope/sequencer jargon).
  - It leads the TLDR, above the deliverables list and size estimate; the dense detail follows. "Explain it to a teammate in the hallway," not "scan the change list."
- Why: A reader should get the gist before diving deep; a jargon-dense TLDR forces full attention just to understand the shape.
