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
  - Every implementation change maps to a tracked unit of intent. Which unit depends on the route ([`../orchestration.md`](../orchestration.md) → "Which issues get a spec"): a **feature / enhancement** gets a full `spec/*` spec per BP-037; a **bug** gets none — the Linear issue is the contract and the fix is reviewed on its implementation PR.
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

### BP-037: Specs live on their spec PR and in Linear — never on `main`

- Status: Active
- Date: 2026-06-29 (updated 2026-08-07: `spec/` + CI guard; Linear is the only durable copy)
- Scope: Process — spec authoring (`issue-spec`).
- Rule:
  - Write the spec to `spec/<ISSUE-ID>.md` on branch `spec/<ISSUE-ID>` and open a spec PR for it (separate from the implementation PR) so the project's automated reviewers critique the design before any code is written. Applies to issues **on the spec route** — a bug has no spec and no spec PR by design (BP-002).
  - Follow [`../spec-template.md`](../spec-template.md), whose every section is a worked example of that section filled in. An epic's coordination artifact follows [`../epic-spec-template.md`](../epic-spec-template.md) the same way.
  - **The spec never reaches `main`, and this is enforced, not asked.** `scripts/validate-spec-folder.mjs` fails CI on any PR carrying a file in `spec/`; the spec PR itself is exempt **by its branch name** (`spec/*`, and `epic/*` for an epic), not by its `spec` label — the label is applied after the PR is created, and `labeled` is not a default `pull_request` event type, so a label-keyed exemption would fail on the opening run and never re-run. Do not "land the approved spec on the implementation branch" — that was the old workaround and it is now a red check.
  - The spec PR is never merged: `issue-implement` closes it (unmerged, branch deleted) when implementation starts. Review history stays on the closed PR.
  - **Linear is the durable copy — the only one.** The repo keeps no spec after the PR closes, so there is no sync obligation and no second copy to drift. Mirror the spec to the issue's Linear document when it is published, and make any post-approval edit there.
  - **Nothing in the repo cites a spec by path.** A spec file does not exist on `main`, so such a reference is dangling the moment it is written; CI rejects one. A comment states its reason; durable design decisions are promoted into `docs/architecture/*`, and the changeset names the issue (BP-022) so a released change traces back to Linear.
  - Because it never merges, the spec PR is also where a **POC** belongs when the design rests on something unverified — throwaway code under `spec-poc/<ISSUE-ID>-<slug>/` that reviewers can actually run ([`spec-poc`](../../../.agents/skills/spec-poc/SKILL.md)). Triggered, not default; costs no review rounds; never lands on `main`. Cite the PR rather than the branch, since closing deletes the branch.
- Why: Reviewing the spec before implementation catches design problems when they're cheapest to fix — a doc edit, not a code rewrite. Keeping the spec out of the repo keeps a point-in-time plan from being read as current truth, and removes the two-copy sync rule that a prose obligation could never hold.

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
  - The spec PR description leads with the problem, what this does, and what's being asked — then a per-PR **"Parts worth reviewing closely"** block. The reviewer contract from `spec-template.md` (what's in scope to challenge, what's deliberately unsettled) is the one lever available on reviewers we can't instruct, and it sits **collapsed below the fold**, where a bot still reads it and a human skips it. Both blocks are required on every PR we open, at the altitude that PR is reviewed at; canonical in [`../pr-reviewer-guidance.md`](../pr-reviewer-guidance.md).
- Why: Spec-PR review comes mostly from automated reviewers tuned for code, pointed at a document that is deliberately not a finished design. Treating every line-level observation as a spec defect turned directionally-sound specs into ten-round grinds, at the altitude where none of that detail can actually be settled. Full rule, with the rationale for why converging is safe: [`../orchestration.md`](../orchestration.md) → "Spec review: the bar and the convergence rule".

### BP-039: Lead with the problem, fold the rest

- Status: Active
- Date: 2026-06-29 (scope widened 2026-08-07 from specs to every artifact a human reads)
- Scope: Process — authoring specs, PR descriptions, Linear issues, and review comments.
- Rule:
  - Begin every artifact with the **problem** in 2–4 plain-language sentences — no file paths, type names, or block/capability/scope/sequencer jargon — then the solution, then what's asked of the reader. **Nothing precedes the problem.** "Explain it to a teammate in the hallway," not "scan the change list."
  - Everything else goes **below the fold**, collapsed rather than deleted — except news the reader wouldn't think to look for (a decision, a risk, a known gap, anything hard to reverse, scope that grew), which stays above it, short.
  - The full rule — the fold, the per-artifact word budgets, the density checks, the `<details>` mechanics — is canonical in [`../writing-for-humans.md`](../writing-for-humans.md), and the PR-description layout applies it in [`../pr-reviewer-guidance.md`](../pr-reviewer-guidance.md). Read them there; this BP is the index entry, not a third copy.
- Why: A reader should get the gist before diving deep; a jargon-dense opening forces full attention just to understand the shape. Written the other way round, the first screen is derivation and process text, the human skims, and the direction review — the only one they can give and a bot can't — doesn't happen.

### BP-041: Frame every ask as a business decision

- Status: Active
- Date: 2026-08-08
- Scope: Process — anything that asks the user to sign off, choose, or unblock: a conversation turn, a spec's §6/§12, a PR's *What's asked of you*, a gate, an escalated blocker.
- Rule:
  - You are the engineer; the user is the **product owner**. Translate the call into the decision *they* are making — what it costs in customers, promises, timing, and reversibility — not the mechanism that produced it. They are technical, which makes handing them the mechanism easy and still wrong.
  - Six parts: **the fork as the heading** (a plain-language either/or) · **plain terms** (observable behaviour, no paths, symbols, or framework jargon) · **the trade-off** (in their currency) · **my recommendation** (always — a neutral fork spends a round extracting the view you already have) · **what would change my mind** (the fact you don't have and they might) · **what being wrong costs** (calibration).
  - **Not every decision is an ask.** A spec's §6 rows the human is merely ratifying stay one line each with a cost column; the full shape is for the one or two genuinely open forks, plus §12. Don't ask at all when the call is the implementer's, the answer is derivable, or it's a coin flip with near-zero cost either way — decide it and note it.
  - Engineering detail is the ask only when no business framing survives the translation (usually a coherence fork). Rare — say out loud that it's happening, give the minimum vocabulary, and keep the rest of the shape.
  - Canonical: [`../asking-for-decisions.md`](../asking-for-decisions.md), with a worked example. This BP is the index entry, not a second copy.
- Why: The product owner's job is the objective and the process as a whole, and attention spent re-deriving a call the engineer already made is attention not spent there. An ask written in mechanism gets a clarifying question back, or a rubber stamp — both worse than a decision.
