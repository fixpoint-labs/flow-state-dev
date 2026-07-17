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
  - Every implementation change maps to a spec linked to its Linear issue (full `docs/specs/*` spec per BP-037 for non-trivial work).
  - Each spec carries explicit deliverables and verification steps.
  - Spec-lite is allowed for small, local work: a one-screen agent brief on the issue, or — for a clear-repro bug — its reproduction + regression seam, instead of a full spec doc (see `fsd:implement-issue`, `fsd:quick-fix`).
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
- Date: 2026-06-29
- Scope: Process — spec authoring (`fsd:create-spec`).
- Rule:
  - Write each spec to `docs/specs/<ISSUE-ID>.md` and open a spec PR for it (separate from the implementation PR) so the project's automated reviewers critique the design before any code is written.
  - The repo spec and the Linear spec document are the same content — keep them in sync; any edit to one mirrors to the other in the same change.
  - On spec-PR review: apply clear, obvious fixes directly (to both copies); for debatable or judgment-call feedback, surface it to the user rather than silently accepting.
  - The spec PR is never merged: `fsd:implement-issue` closes it (unmerged, branch deleted) when implementation starts. Review history stays on the closed PR; the Linear document is the durable copy from then on. Merging would accumulate point-in-time spec docs on main that go stale as implementation deviates.
- Why: Reviewing the spec before implementation catches design problems when they're cheapest to fix — a doc edit, not a code rewrite.

### BP-039: Specs lead with a plain-language summary

- Status: Active
- Date: 2026-06-29
- Scope: Process — spec authoring (`fsd:create-spec`).
- Rule:
  - Begin every spec with a 2–4 sentence plain-language summary of the *solution* — what we're doing and why, in terms a multitasking or non-expert reader can grok without the framework vocabulary (no file paths, type names, or block/capability/scope/sequencer jargon).
  - It leads the TLDR, above the deliverables list and size estimate; the dense detail follows. "Explain it to a teammate in the hallway," not "scan the change list."
- Why: A reader should get the gist before diving deep; a jargon-dense TLDR forces full attention just to understand the shape.

### BP-040: Document intent when discoverability and enablement diverge

- Status: Active
- Date: 2026-07-17
- Scope: Docs site (`apps/docs`) — Docusaurus config, sidebars, and nav.
- Rule:
  - When you remove navbar, footer, or sidebar links but leave the underlying plugin, route, or content tree enabled (e.g. blog still builds at `/blog/*`), add a short comment at the config switch stating the product intent: *unlisted but reachable*, *deprecated pending deletion*, or *fully removed* — and what a future editor should do instead of "fixing" the missing links.
  - If the goal is to drop the feature from the site entirely, prefer disabling the plugin or removing the content in the same change rather than only hiding navigation.
- Why: Partial hides look like oversights; without an inline intent comment, the next change often re-adds links and undoes the product decision.

### BP-041: Docs code-block theming — one owner, built-ins first, contrast check

- Status: Active
- Date: 2026-07-17
- Scope: Docs site (`apps/docs`) — Prism/syntax themes and `src/css/custom.css` code surfaces.
- Rule:
  - Before adding or extending a custom `prismThemes` palette, try built-in `prism-react-renderer` themes that match the site register (BP-029); keep custom token maps only after a deliberate visual rejection of those built-ins.
  - Own each code-block visual invariant in one layer — e.g. background color in the Prism theme's `plain.backgroundColor`, not also on `.prism-code` in CSS (especially with `!important`).
  - After palette or surface changes, verify WCAG AA contrast (≥ 4.5:1 for normal-sized text) for syntax tokens against their code-block background in **both** light and dark themes; prioritize comments and other explanatory tokens readers rely on in examples.
- Why: Duplicate theme/CSS owners drift on the next tweak, custom palettes add maintenance without trying built-ins first, and muted "earthy" comment colors often fail AA on light code surfaces.
