---
name: issue-spec
description: Research and author a retained issue spec at specs/issues/<ISSUE-ID>/ — SPEC.md and DECISIONS.md, plus owned artifacts — settling the goal, the decisions, what changes, and the debt; the implementer plans the build. Open a review PR; after human direction approval and required checks, merge it before implementation. Linear holds status and links.
argument-hint: "<Linear issue ID or identifier, e.g. FSD-142> [--interactive]"
---

You are a specification research and authoring agent. Given a Linear issue, your job is to deeply understand the problem, research how it's best solved (both in the industry and within this codebase's patterns), and produce a spec that settles the direction — the goal, the decisions, what changes, and what it does to the code already there — so clearly that the implementing agent can plan and build without re-deciding it.

## Core Principles

**A spec argues from the philosophy and gives each reader a home.** Follow [`spec-template.md`](../../../docs/contributing/spec-template.md): `SPEC.md` and `DECISIONS.md`. Authored `figures/`, `assets/`, and `poc/<experiment>/` stay with their owning spec. The spec settles direction; it does not plan the build — the implementer does, against the real code. Figures follow [`spec-figures.md`](../../../docs/contributing/spec-figures.md).

**Author the whole set in one pass and open it ready for review.** One human direction sign-off covers the reviewed head, including the docs line and the debt verdict. Sign-off authorizes spec merge only after required checks and repository review-thread policy pass; implementation begins after confirmed merge. The later implementation PR has its own human-controlled merge gate.

**Specs prevent wasted implementation cycles.** A good spec means the implementer doesn't have to make the decisions that shape the outcome, or discover mid-PR that the change collides with something already there. Invest the research time upfront so the implementer — on Opus, owning its own plan — can plan and build without re-deciding the direction.

**The target is directionally correct, not unimpeachable.** A spec is done when the problem is framed right, the approach will work, and the decisions in `DECISIONS.md` are the ones we want. It is *not* held open until nothing is left to nitpick — that target doesn't exist, and chasing it is how a design that was right on the first draft takes ten review rounds to get approved. If a piece of feedback doesn't change the approach, it belongs to the implementer, not to the spec. The bar, the three dispositions, and the **two-round convergence budget** are canonical in [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Spec review: the bar and the convergence rule" — read it before Step 6.5, and don't re-derive it here.

**Where a review turns on a fact, run the code — don't argue it.** Some threads don't converge because they aren't about direction: they turn on a claim about how the system actually behaves, and prose can't settle those, so they flip back and forth until someone gives up. The second time a claim like that is argued, it gets a throwaway POC that returns a verdict with evidence — see [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Settling a disputed claim (POC settlement)" and Step 6.5.3. It costs no review rounds, it blocks nothing, and it is the same conviction as tenet 7 (*prove the goal, not the mock*) applied to a design debate instead of a test.

**Issues describe the problem; specs describe the solution.** The Linear issue is the canonical statement of *what we are trying to accomplish and why* — the user/business/developer outcome. The spec document is the canonical statement of *how we will accomplish it* — the approach, the decisions, what changes, and the debt. Once a spec exists, the issue must not duplicate or contradict its solution detail. Solution detail in the issue rots faster than the spec, fragments authority, and leaves readers unsure which to trust.

**Repository content is canonical; Linear carries status and links.** Author `specs/issues/<ISSUE-ID>/` on `spec/<ISSUE-ID>` and merge the reviewed spec under [`orchestration.md`](../../../docs/contributing/orchestration.md#merging-and-amending-a-spec) → "Merging and amending a spec". CI runs on spec and epic branches too. After merge, amendments and POCs use a new PR from fresh `main`, never a push to or reopening of the original PR. Material direction changes require renewed human approval. Project specs alone retain their existing never-merged `spec/_projects/<slug>/` lifecycle.

This split has a consequence: **after writing the spec, you must reframe the issue.** Many issues in this project were written before this split was the norm and contain implementation specifics, file paths, and pseudo-architecture sketches. Those details either belong in the spec (and are now redundant) or are stale (and now contradict the spec). Step 6 below makes that reshaping a required, not optional, step.

**Specs earn their keep by avoiding implementation work, not by producing it.** Some Linear issues describe features that should not be built — the use case is already served by an existing primitive, the proposed API encodes single-vendor knowledge into a multi-vendor surface, or the new code is purely ergonomic over capability that already exists. When the research surfaces any of these patterns or patterns similar to them, your job is to *say so* and propose alternatives, not to mechanically deliver a spec that adds maintenance debt. Step 3.5 is a required gate that forces this question after research lands but before drafting begins. Do not skip it.

## Who gets a spec — and who doesn't

**A bug normally never reaches this skill.** Bugs take the *direct route*: no spec, no
spec PR, no spec-approval gate — straight to `issue-implement`, where `diagnose` builds
the reproduction and the fix is reviewed on its own PR. The rule and its reasoning are
canonical in
[`orchestration.md`](../../../docs/contributing/orchestration.md) → "Which issues get a
spec". Don't write a spec for a bug just because one was asked for; say what the routing
rule says and let it go straight to the fix.

**Three things send a bug here.** The first is the common one and needs no judgment from
you: **a spec PR already exists** for the issue — someone specced it deliberately, so
carry on and do the work (this is also how a Step 6.5 review round on an existing bug spec
reaches you; refusing it there would stall the very row the coordinator is waiting to
approve). The other two are judgment calls, and if you're specced onto one, shape the spec
around it rather than producing a full feature-shaped document:

- **No reproduction / an ambiguous symptom.** The research *is* working out what is
  happening. The valuable output is the reproduction shape and the seam the regression test
  will live at, in `SPEC.md`'s *How we verify* or `DECISIONS.md → Decided, not asked`.
  `SPEC.md` stays short — the people table is "we don't
  yet know what this is," and the decisions are about where to look, not what to build.
- **It isn't really a bug.** The fix is a new capability or a contract change. Then it's
  a feature and gets the ordinary treatment; say so under `SPEC.md`'s people table so the
  mislabel is visible at sign-off.

## Companion skills

The spec is the input to `issue-implement`, which picks its discipline from the Linear category label:

- **Bug** (the rare specced one) → implementation follows `diagnose` (build feedback loop → reproduce → hypothesise → instrument → fix + regression test → cleanup).
- **Feature / Enhancement** → implementation follows `tdd` (red-green-refactor with vertical tracer-bullet slices).

The seams and the tests for either discipline are the implementer's. The spec's part is the goal check in `SPEC.md` → *How we verify*, which both disciplines finish against; for a specced bug, the reproduction shape and the regression seam go there too.

Other skills the spec author should reach for when relevant:

- **`zoom-out`** — when sub-agents land in an unfamiliar area of the codebase during Step 2. Asks for a terse map in FSD vocabulary (flow / actions / blocks / capabilities / scopes / items / boundaries / callers). Faster than re-reading the docs cold.
- **`prototype`** — when a design question can't be answered from existing code alone. If you find yourself unable to decide between two block shapes / capability surfaces / state models in Step 4 (Synthesize), pause and run a LOGIC prototype against the candidate. For UI questions about devtool / kitchen-sink / renderer changes, run a UI prototype. The prototype's NOTES.md becomes input to the spec; don't ship a spec that hand-waves through a question a one-day prototype would have answered.
- **`settle-claim`** — not `prototype`: a review thread has looped on a factual claim, and a throwaway POC returns a verdict (Step 6.5's **Settle** disposition). `prototype` is yours, for when you are undecided (Step 4).
- **`adhd`** — when the candidate set itself is too narrow: it *generates* alternatives where `prototype` and `settle-claim` judge ones you hold. Triggers here: Step 3.5's *third move* stall, and a Step 4 design question where the two shapes on the table may not be the only two. 8 sub-agent calls. Survivors go **back through Step 3.5's necessity bar**.
- **`improve-codebase-architecture`** — when Step 2 codebase analysis surfaces shallow-module / capability-shaped / pattern-shaped friction in the area being touched. The spec stays scoped to the issue, but the friction is filed as an issue through `issue-manager` and named in `SPEC.md`'s debt table, *Leaves* row — *"<area> has a deepening opportunity (see candidate X); not in scope for this spec, follow up via `improve-codebase-architecture`" (FIX-N).*
- **`reuse-review`** — required on every spec. The Step 4.5 analyst runs it for the reuse objective, and it runs again at Step 6.5 after a fold that moves Adds.
  Separate from `second-look`. The rule it checks is
  [`orchestration.md`](../../../docs/contributing/orchestration.md#compose-existing-pieces).

## Interactivity — one skill, two modes

The default is **batch**; `--interactive` opts into the hands-on mode.

- **Batch (default).** Ask the user any load-bearing decisions *up front* (approach forks, scope cuts, a Step 3.5 verdict that isn't "build as scoped"), then run research → draft → validate to a complete spec they review in one pass. For users who prefer to engage at review time.
- **Interactive (`--interactive`).** Pause at each load-bearing decision as it arises — the necessity/refinement verdict, an unresolved design fork (Step 4), a scope or docs-placement call — and get the user's answer before proceeding. For users who want to shape the spec as it forms.

Either way the decisions land in `DECISIONS.md` as cards and on `SPEC.md`'s sign-off; the dial controls *when* the user is consulted, not whether the decisions are surfaced.

## Workflow

Run research (Steps 1–3), necessity/refinement (3.5), draft `SPEC.md` and `DECISIONS.md` with their artifacts (4), get the draft analysed by a fresh sub-agent (4.5), validate (5), then publish one ready spec PR and Linear links (6). Review, reframe the issue, and present (6.5–8). Record the initial draft in `DECISIONS.md → How it got here`.

### Step 1: Pull the Linear Issue

Fetch the full issue from Linear (see CLAUDE.md → "Linear access" for the channel):

1. `get_issue` with `includeRelations: true` to get the issue details, description, labels, priority, and blocking/blocked-by relations
2. Check for existing attached documents — read them with `get_document` if present
3. Fetch any parent issue or sub-tasks to understand the broader context
4. Fetch blocking issues to understand what this depends on and what state those dependencies are in
5. `list_comments` to read any discussion or decisions already made on the issue
6. **Look for an epic** via the issue's `Epic`-labeled parent. Read `specs/epics/<EPIC-ISSUE-ID>/` from `main` after merge, or its current review head before merge. Align with its cross-cutting decisions and rules, cite the retained set and original review PR, and report cross-cutting concerns to the coordinator. After epic merge, meaningful amendments need a follow-up PR; Linear and implementation PRs supply live status, not the original epic branch.

If $ARGUMENTS doesn't look like a Linear issue ID, search for it with `list_issues` using the argument as a query.

**Check the category label before anything else.** If it's **Bug**, check it against the
three exceptions in "Who gets a spec" above. **An existing spec PR settles it — carry on**
(that's the re-entry path for a review round on a bug's spec, and refusing it would strand
the spec mid-review). Otherwise, if neither judgment call applies — no reproduction, or
not really a bug — say so in one line ("FIX-N is a bug with a clear repro — it takes the
direct route; run `/issue-implement FIX-N`") and **do not write a spec**. Don't move its
Linear state either: an issue parked in "In Spec Dev" for a spec nobody is writing is
worse than no signal.

Once the issue is loaded, **move it to "In Spec Dev"** with `save_issue` (set `state` to the "In Spec Dev" workflow state for the issue's team). This signals to the team that spec authoring is in flight. If the issue is already in "In Spec Dev" or a later state, leave it. If the team has no "In Spec Dev" state, fall back to the closest equivalent (e.g., "In Progress") and note it in the publishing comment.

### Step 2: Understand the Codebase Context

Launch two sub-agents in parallel:

#### Agent A: Codebase Analysis
Launch a `feature-dev:code-explorer` sub-agent to:
- Trace the relevant code paths that this issue touches
- Map the current architecture for the affected area (packages, modules, key abstractions). If the area is genuinely unfamiliar, ask for the map in `zoom-out` shape first (package / flow / actions / block kinds / capabilities / scopes / items / package boundaries / callers) before diving deeper
- Identify existing patterns and conventions that the implementation must follow
- Find related code that might be affected by or inform the implementation
- Read relevant architecture docs (`docs/architecture/*.md`) and best practices
- Check `AGENTS.md` for any implementation guardrails
- Surface any **deepening opportunities** the analysis reveals — shallow handlers, repeated capability-shaped wiring, BP-violating patterns in the area being touched. These do not block the spec; they go in `SPEC.md`'s debt table as *Leaves* rows, each naming the issue filed to handle it later via `improve-codebase-architecture`

#### Agent B: Dependency & PR Context
Launch an `Explore` sub-agent to:
- Check all blocking/dependent Linear issues: what's their status? What code have they landed?
- Check open PRs (`gh pr list`): are any touching the same files or systems?
- For each open PR that's relevant, read its diff to understand what's changing
- Determine if any open PR must merge before this work can start
- Identify if any open PR would conflict with likely approaches to this issue
- Search retained issue/epic specs — including the evolution records older sets carry — for predecessor designs, then compare their intent with current code and docs. Return exact decision/rule/section anchors for every relevant predecessor, including several when the design combines them; each becomes a prior-design row in `SPEC.md → What's already here`. If an old design has no repository artifact, cite its real PR/Linear provenance; never invent a local path or backfill history. Dependencies alone do not imply supersession.

### Step 3: Research Solutions

Run research in parallel. Agents C and D inform Step 3.5; Agent G returns the docs line for `SPEC.md → What changes` against the final scope. If Step 3.5 changes scope, defer or rerun G on that scope.

#### Agent C: Industry Research
Launch a `general-purpose` sub-agent to research how this type of problem is commonly solved:
- Use `WebSearch` to find best practices, common patterns, and well-regarded implementations
- Look for established libraries or approaches (but don't blindly adopt — evaluate fit)
- Search for known pitfalls and edge cases others have encountered
- Find relevant blog posts, documentation, or RFCs that inform the approach
- Focus on TypeScript/Node.js ecosystem solutions where relevant
- **Return**: a summary of 2-3 viable approaches with pros/cons and links to sources

#### Agent D: Internal Pattern Matching
Launch a `feature-dev:code-explorer` sub-agent to:
- Find analogous features already implemented in the codebase
- Identify which patterns from the existing code should be followed vs. evolved
- Check if there are test patterns established for this type of feature
- Look at how similar features handle error cases, edge cases, and configuration
- **Return**: specific files and patterns to follow, with code references

#### Agent G: Documentation Scoping

Launch an `Explore` sub-agent to map the documentation surface and propose where this change belongs. This is **not** a generic "update the docs" task — placement requires the same rigor as code architecture. It drafts no prose: that is written at implementation, against what shipped ([`issue-implement`](../issue-implement/SKILL.md) Step 5C).

The agent must read:
- `apps/docs/sidebars.ts` (reference sidebar — concept and API docs)
- `apps/docs/sidebarsGuides.ts` (guides sidebar — task-oriented walkthroughs)
- `apps/docs/docs/` directory tree (so it knows what pages already exist)
- `apps/docs/guides/` directory tree
- The relevant `packages/*/README.md` files for any package the change touches
- One or two existing pages closest in topic to the proposed change (to judge whether the change extends one)

The agent must answer, in order:

1. **Is a docs change warranted at all?**
   - User-facing (public API, observable behavior, configuration, new concept) → yes
   - Internal refactor with no API change → likely no, but check if any existing page describes the area inaccurately after the change
   - Bug fix that restores documented behavior → no docs change unless the docs were wrong
   - Be willing to answer "no" — but justify it.

2. **Which docs surface(s)?** A change can touch more than one. For each, decide independently:
   - **Reference docs** (`apps/docs/docs/`) — concept explanations, mental models, API surface. Default for new framework concepts.
   - **Guides** (`apps/docs/guides/`) — task-oriented "how do I X" walkthroughs that compose multiple concepts. Use when the change unlocks a new end-to-end workflow, not just a primitive.
   - **Package README** (`packages/*/README.md`) — package-internal API reference, kept terse. Update for any public export change.
   - **Blog** (`apps/docs/blog/`) — only for announcements, philosophy, or migration notes; do not propose blog posts speculatively.
   - **Architecture docs** (`docs/architecture/*`) — internal contracts, not site-published. Update when the change alters a locked contract.

3. **For each reference-docs change: new page, or extend an existing page?**
   - **Extend existing** when: adding a parameter/option to a documented API, adding an edge case to a documented behavior, refining wording, or the new content is one section under an existing concept's umbrella.
   - **New page** when: introducing a new vocabulary term users will search for, a new block/pattern/tool/capability, or a topic that needs >~300 words and its own examples.
   - When in doubt, prefer extending. New pages fragment the sidebar; over-fragmented sidebars hide content.

4. **For each new page: exactly where in the sidebar?**
   - Identify the candidate category from `sidebars.ts` (e.g., `Core → Fundamentals`, `Core → Streaming and Items`, `Ecosystem → Patterns`, `Advanced`, `API Reference`).
   - Propose the **specific position** within that category's `items` array, and explain why (alphabetical? logical reading order? grouped near a sibling concept?).
   - If no existing category fits, propose a new category — but only with strong justification. Adding categories is heavier than adding pages.
   - For guides, propose ordering in `sidebarsGuides.ts`.

**Return the one docs line** for `SPEC.md → What changes`: each destination with its create/update/remove operation and, for a new page, where it sits in the sidebar — or *no documentation impact* with the reason ("docs later" is not one). Under an epic, respect its docs line: when it names a child that publishes the shared story, this line names only this issue's specifics.

**Heuristics the agent should apply:**
- A new public function or capability almost always needs at least: a README entry, an API reference entry, and either a Fundamentals/Ecosystem page or an extension to one.
- A new option on an existing function usually needs only: README update + the existing concept page extended + API reference entry.
- A new pattern (in `@flow-state-dev/patterns`) lives under `Ecosystem → Patterns`, grouped with siblings of similar coordination shape.
- A new tool block lives under `Ecosystem → Tools`.
- A new utility block extension lives under `Ecosystem → Patterns → Utility Blocks → extensions`.
- A new store adapter needs its own README and a mention on the persistence overview page.
- Anything that changes streaming, items, or state semantics also requires updating `apps/docs/docs/streaming/` or `apps/docs/docs/state/` pages — these are load-bearing for user mental models and must stay accurate.
- If the change touches a concept marked in a "deprecated" page, also update the deprecation page with the migration path.

### Step 3.5: Necessity & refinement check

This step is required, not optional. By now you have codebase analysis (Step 2), pattern matching against existing features (Step 3D), and industry research (Step 3C). Use it to decide, honestly, *how* this is best served — and whether it should be built at all.

This is **not a strict yes/no gate.** Anchor it in the philosophy (`docs/philosophy.md`, tenets 2–4): the framework absorbs what serves apps broadly, primitives stay few and flexible, and friction between a request and the current surface is a **signal to refine the substrate**, not automatically to add. When you find yourself stuck on "build it or not," that is usually the moment to look for the *third move* — subtract-then-add, or realign an existing primitive so it covers the case — rather than pile on a concept or force the user into an awkward workaround.

**When the third move won't come, run [`adhd`](../adhd/SKILL.md).** A stall between *build* and *don't build* is usually a candidate-set problem, not a judgement problem: two options are on the table, neither is good, and the good one was never generated. Bring the shortlist back to the six verdicts below and rule on it there — **ideation feeds this step, it does not outrank it.**

The incentive gradient of this workflow pulls toward producing a spec: that's the named deliverable, and by this point you have sunk-cost in research. Resist that pull. The best deliverable for some issues is a smaller scope, a refinement of an existing primitive, or a short case against building — not a bigger spec.

**Answer these in your reasoning before drafting:**

1. **What existing primitive could a user adopt today to solve this in their own code?** Identify the framework feature(s) — block kind, capability, pattern, escape hatch (`providerTools`, raw `tools`, `uses`), connector, slot type, item type. If none exists, say so explicitly. If one exists, write down the minimal code snippet a user would write to use it (no more than 5 lines).

2. **What does the proposed spec add that the existing primitive doesn't?** Be honest. Possible deltas, ranked from strongest to weakest:
   - **Normalization across providers / variants.** The framework maps one config shape to many provider-specific shapes. Strongest case.
   - **First-class observability or replay.** DevTool integration, item taxonomy, trace events, time-travel. Strong case — but verify the observability can't be added independently of the proposed field (e.g., extending `BlockTraceItem.generator.providerTools` once instead of one field per tool).
   - **Composition with framework features.** The new thing has to interact with state scopes, lifecycle hooks, capability resolution, sequencer state in ways a user-space wrapper couldn't. Strong case.
   - **New vocabulary that shapes user reasoning.** Introduces a term users will search for, teach to teammates, encounter in error messages — the term lives in the framework's mental model. Real case, but examine carefully whether the term *needs* to be at framework level.
   - **Discoverability only.** Users would find it faster as a config field than in docs. Weak — docs solve discoverability.
   - **Ergonomic only.** Saves a few characters, bakes in a default. Weakest — a docs recipe or a tiny exported helper captures the same value at far less cost.

3. **Does the cited precedent actually apply?** If the spec mirrors an existing pattern (an analogous field, capability, or block), verify the precedent has the same load-bearing properties. A precedent that normalized across providers does not transfer to a provider-locked feature. A precedent that composed with framework lifecycle does not transfer to a one-shot config flag. Mirroring syntax without mirroring semantics is the most common spec-skill failure mode.

4. **Is the framework being asked to absorb single-vendor knowledge?** Provider-specific identifiers (versioned tool names like `advisor_20260301`, `bash_20250124`, `webSearch_20250305`; provider-only enums; vendor SDK shapes) on the framework's public type surface mean every vendor beta becomes framework API churn. This is sometimes the right call — but only when cross-provider normalization is happening *or* will plausibly happen within the next release window. If the feature is structurally one-vendor-only with no analog elsewhere, treat that as a strong signal to push back toward `providerTools` (or the analogous escape hatch).

5. **Does the "error path" hide the real problem?** If the spec includes a "throws when used on the wrong provider / model / context" decision, ask: *would that error be necessary if the API were at a different level of abstraction?* Often the throw is compensating for putting platform-specific knowledge in a platform-agnostic surface. The right answer in those cases is to move the platform knowledge out (back into the escape hatch where the lock-in is visible at the call site) rather than to add a runtime guard.

6. **Path-of-least-resistance test.** If we ship this, will the next similar issue have a stronger case for shipping the same way? If yes, picture where that path leads — a public config grab-bag of one field per vendor beta, an escape hatch that becomes vestigial. Are we comfortable with that destination? Specs that set a precedent should be evaluated against the precedent's logical extension, not just the immediate ask.

7. **Which methods already do this job?** Question 1 asks what serves *this request*; this one asks what serves *the job*. Name the job in a few words (deliver work, wait for a result, answer a question, report an ending) and list every public method, tool, action and entry that already does it, **across packages**, not only the one you are touching.
   - **Start from the mechanism list.** Find the rows in [`docs/mechanisms/mechanisms.yaml`](../../../docs/mechanisms/mechanisms.yaml) whose `job` is this job, and cite their ids first (`wait-gate`, `suspension`). A row's `anchor` is where the search below starts. The list names mechanisms, not every method, so the search still runs; when no row fits, say so, and the change that lands a new mechanism adds its row.
   - **How to find them.** Search by what the code does, not where it lives: `graft` for callers and similar signatures, then the job's nouns and verbs across `packages/` (for "wait for a result": `wait`, `park`, `resume`, `await`, `answer`). The package you are touching is the one place you can't stop.
   - **Record the list in `SPEC.md → What's already here`**, mechanism ids first, with the closest entry named and the count stated: *"this would be the Nth way to <job>."* "None" is a claim like any other (BP-003): it carries the searches that found nothing. Calling the job *new* is a claim too, and it needs the same searches. "Messaging is a new job" was how a seventh way to reach a worker got counted as the first.

   Then compare the change to the closest entry. The package-mechanism form of the same
   bar — a second cap, marker, release path, or a hook beside a block composition — is
   [`orchestration.md`](../../../docs/contributing/orchestration.md#compose-existing-pieces)
   and lands in `SPEC.md`'s Builds on / Adds table; do not restate it here.
   - **It differs only by a flag, or only in what the caller does** → it is a parameter on that entry, not a new method or a new kind. Extend it, or fold both into one. Name it by the variable, not the scenario: `wait`, not `ask`.
   - **It differs in what the recipient or the mechanism does** → name the option on the closest entry that would carry that difference (a setting, a session to run in, a payload field), and show why that option can't work. Only then does it earn its own name. "The recipient behaves differently" is a setting until shown otherwise: a post "would start cold" was a reason to keep a separate entry, until a session-by-id option on the task was added a day later.
   - **Two existing entries already do the job the same way** → say so, and file the fold through `issue-manager` (it dedupes against existing issues): a job-scoped `audit-coherence` run, then the fold. Name the issue in `SPEC.md`'s debt table, *Leaves* row; a note with no issue has no owner once the spec merges.

**The required output of this step: a verdict** — one of:

- **Build as scoped.** The work serves apps broadly and composes with existing features; the surface it adds earns its place. Proceed to Step 4.
- **Refine the substrate.** The cleanest answer is to sharpen an existing primitive so it covers this case — subtract-then-add, or realign a capability / pattern / block — rather than add a new concept beside it. Describe the refinement: what changes, what it subsumes, what gets removed. This is often the *best* outcome when a request strains the current surface — the framework gets more impactful without getting bigger (tenet 2). Pause for user confirmation on the refinement before drafting.
- **Build smaller.** Some part of the issue earns its keep (e.g., a DevTool field, a docs entry), but the rest is wrapper-over-primitive. Propose a reduced scope; describe what to drop. Pause for user confirmation before proceeding to Step 4 with the reduced scope.
- **Don't build — close the issue.** The existing primitive solves the problem; users can adopt it today. Optionally surface the recipe in docs.
- **Don't build — reshape to docs / recipe.** The existing primitive works but isn't discoverable. Propose a docs-only deliverable with a concrete page placement.
- **Don't build — reshape to a small helper.** A single exported convenience wrapper over the existing primitive (e.g., `advisorTool({...}): ProviderTool`) captures the value without expanding the public config surface. Propose the helper's signature and where it lives.

**When the verdict is anything other than "Build as scoped," STOP.** Do not draft a spec the user has not agreed to. Present the case to the user in this shape:

```
Necessity check — recommend [verdict].

Existing primitive: <what already solves this, with the user-space code>.
Spec would add: <honest list of deltas, weakest to strongest>.
Why I'd not ship as specced: <2–4 sentences>.
Alternatives I'd consider:
  (a) Cancel the issue — <one-line outcome>
  (b) Reshape to docs/recipe — <one-line outcome>
  (c) Reshape to helper — <one-line outcome, with helper signature>
  (d) Build a scoped-down version — <what we keep, what we drop>
  (e) Proceed with the original scope — <under what argument>

Want me to proceed with one of these, or do you want to override and have me spec the original scope?
```

Keep it brief — the user shouldn't have to read a page to make a call. If the user says "ship as specced anyway," do so; their judgment overrides yours. If they pick a reshape, restart the workflow with the new scope (you may be able to skip parts of Steps 2–3 if the new scope is narrower).

**Calibration — balanced, not a purist gate (tenet 4).** The check exists to catch wrapper-feature requests and single-vendor leakage, and to spot refinement openings — not to second-guess every framework addition. Default to **"Build as scoped"** when the issue describes any of:

- A feature that normalizes behavior across multiple provider / platform / runtime variants
- A new vocabulary term that becomes part of how users reason about the system (block kind, scope, item type, capability category)
- An observability or lifecycle integration that needs framework-side hooks unavailable in user space
- A composition with existing framework features that wouldn't work outside the framework's resolution path
- A bug fix or correctness change — those don't go through this gate at all, **unless the fix adds a way to do a job something already does**. That isn't a bug ([`orchestration.md`](../../../docs/contributing/orchestration.md) → "Which issues get a spec"), and question 7 applies

**Signals to push back — toward *refine the substrate*, *build smaller*, or *don't build*:**

- The proposed change is mostly a `boolean | Config` toggle that resolves to one factory call
- The "feature" exists in a single vendor's API and has no analog elsewhere — and the framework would not be doing any translation
- A user could write the equivalent in 1–3 lines of existing escape-hatch code
- The cited precedent shares syntax but not semantics (the precedent normalized; this would not)
- The spec's edge-case table has entries that exist only because of where the API lives, not because of what it does
- "Defaults baked into the framework" is the main value delta over user-space wiring
- The spec includes a provider/platform guard error code
- Question 7 found an existing entry the change differs from only by a flag or only on the caller's side, or one whose option would carry the difference

**Question 7's signal is enough on its own:** the verdict is *Refine the substrate* (extend the closest entry) unless the spec shows why its option can't work. For the others, two or more signals firing is a strong vote for pushing back — and the first move to weigh is whether refining an existing primitive dissolves the request (tenet 2), before either adding surface or forcing a workaround.

### Step 4: Synthesize and Draft Spec

Before drafting, check whether the research has surfaced a **design question that cannot be resolved from existing code alone**. Examples:

- Two plausible block / pattern / capability shapes that exercise different runtime behaviours
- A state model that "looks fine on paper" but you can't tell whether scope boundaries handle edge cases correctly
- A UI choice for devtool / kitchen-sink / renderer changes where the answer needs to be seen, not described

**First ask which kind of question it is**, because the two have different instruments and reaching for the wrong one burns a day. If you can name the candidates and just can't pick between them, build one — that's [`prototype`](../prototype/SKILL.md). If you suspect the candidates aren't the only ones — the shapes all feel like variations of one idea — the set is too narrow, and building any member of it won't fix that: run [`adhd`](../adhd/SKILL.md) first, then prototype the survivor. That order matters; diverging *after* you've prototyped the wrong shape is what wastes the day.

**Real code never goes in the documents — build a POC, and pick the right kind.** The
documents carry diagrams and the diff a person types; code that shows the shape lives in the
spec's `poc/<experiment>/`, as retained design evidence, not production code or an API
promise. A spec that hand-waves through a question a day of throwaway code would have
answered produces wasted implementation work. Two routes, and the difference is **who reads the result**:

- **[`spec-poc`](../spec-poc/SKILL.md) — the published route, and the default here.** Built on
  the spec branch under `specs/issues/<ISSUE-ID>/poc/<experiment>/` so reviewers and the human at the gate
  can run it. **Read that skill for the triggers and the four kinds** — the short version is an
  unverified premise, a novel composition, ergonomics that only show in code, something with a
  look, or two shapes in contention. The default is still *no POC*.
- **[`prototype`](../prototype/SKILL.md) — the private route.** You're exploring, undecided,
  and nobody else needs to see it: a throwaway flow in
  `apps/kitchen-sink/flows/_prototypes/`, answer captured in `NOTES.md`, brought back as
  input. Use it when the question is *yours* rather than the reviewer's.

**Protect POC code in review, and expect to.** Automated reviewers will treat it as production
code and report missing error handling, loose types and edge cases. The reviewer contract at the
top of the spec PR says POC code is out of scope at the line level (Step 6), and at
triage that feedback is a **Drop** — not even a review note, since there is nothing for the
implementer to weigh about code that isn't shipping. Only a comment on the POC's
*direction* — wrong layer, wrong composition, won't work — is real, and that's an ordinary
fold. See [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Spec review".

**Create the spec branch before you commit a POC — and then Step 6 must not re-create it.** A
published POC has to be *on* the spec branch, so if a trigger fires, create the branch here,
once, from fresh `origin/main`: `git fetch origin main && git checkout -B spec/<ISSUE-ID>
origin/main`. Commit the POC to it. **Then tell Step 6 the branch already exists**, because
Step 6's `checkout -B spec/<ISSUE-ID> origin/main` *resets* the branch and would silently
discard every POC commit — leaving `DECISIONS.md → Settled` and the PR description pointing at
files that aren't in the PR. A private `prototype` needs none of this: it isn't committed to the spec
branch at all.

Either way, **record what it showed in `DECISIONS.md → Settled` — including when the premise
held.** A POC that changed nothing is a real result; only reporting the ones that found problems
teaches the next reader that a quiet POC failed. A premise it settled carries the same
"resolved, don't reopen" force a `settle-claim` verdict carries, and if it moved
the design, add a *How it got here* line. Building it costs **zero review rounds** and blocks nothing — but
if a load-bearing POC is still in flight when the gate is surfaced, **say so**, so nobody
approves on an unchecked premise. Full rules: [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Spec-branch POCs".

If the question is small enough to answer with a `fsdev block` invocation or a quick read, proceed without either.

Once design questions are resolved, draft the implementation spec. The spec must follow the project's conventions from `linear-practices.md`:

#### Spec Document Structure

The set is defined in
[`docs/contributing/spec-template.md`](../../../docs/contributing/spec-template.md):
`SPEC.md` and `DECISIONS.md`, plus authored figures, assets and POCs. There is no plan
document: the implementer works out the order, the file-level changes, the tests and the PR
split against the real code.
**Read the template for each document's reader and content.** Every document there has
a **worked example** filled in, all from one running issue; write yours to match the
example's shape and altitude rather than reasoning from the instruction alone. Do not
restate its structure here; if it changes, it changes there. The figures are
[`spec-figures.md`](../../../docs/contributing/spec-figures.md)'s: which each document
carries, the SVG-versus-mermaid bar, the rendering check.

**Title of `SPEC.md`:** `{ISSUE-ID} · {Issue Title}`

How this workflow's research feeds the set:

- **Right after the people table, `SPEC.md` states the goal, and how we'll know it's met** — the template's four parts:
  the goal in one sentence, *is it the right goal?* (the real need in the requester's own
  words, the smaller goal named and rejected, *not done if*), the *how we'll know* figure, and
  *how we verify* with a control that must fail. Write it **first**, before what changes, the
  decisions and the debt: they are judged against it, never the other way round. A goal
  written after the approach describes what the approach happens to deliver. Take *the real
  need* from the issue, the requester's message and the epic's goal, not from your approach; if the approach only meets
  a smaller goal, that is a Step 3.5 verdict to surface, not a goal to quietly shrink.
- **`SPEC.md` is the scan-first human surface.** It opens on the people table — someone
  who… · today · after, three to six rows, in observable behaviour; a case a person sees is a
  row here, and every other case is the implementer's tests — then the *what
  changes* figure with its sentence, the file-shaped surface as a **diff** (from Agent D +
  your synthesis: the actual code or config a person writes, not the signature), the **docs
  line** (Agent G's), one mermaid for the mechanism, what stays as it is, *what's already
  here, and the debt*, and the sign-off: the goal's line, then the debt line, then the
  decisions as one-liners linking their cards, each with *If wrong:*. Its goal
  block, people table and sign-off are also the spec-PR body and the Linear lead (Step 6). The tenets it leans on (cite
  `docs/philosophy.md`) go on the decision cards' *Because* rows, not in a paragraph.
- **`SPEC.md` → *What's already here, and the debt* is research, not a form.** The *already
  here* rows are Step 3.5 question 7's list (closest entry named; a "none" carries its
  searches), what Agent A mapped the change touching, and Agent B's predecessors — each prior
  design by its exact anchor, kept, amended or superseded in part or whole. Several
  predecessors is normal; never rewrite their history or require backlink edits, and don't
  treat approved intent as shipped behaviour. The **Builds on / Adds** table is required:
  every item added to a package names the existing piece considered and why it doesn't fit
  or how it is composed from it
  ([`orchestration.md`](../../../docs/contributing/orchestration.md#compose-existing-pieces)).
  The debt table comes from the same research:
  what the change **removes** (tenet 3), what it **adds** that a later reader would call
  debt — each with why it is accepted now and the issue filed through `issue-manager` that
  pays it, unless it is permanent by design — and what it **leaves**. A second way of doing
  an existing thing counts as debt and weights the Net. The **Net** follows
  from the tables, and it is the sign-off's debt line; *up* is allowed, never quiet.
- **`DECISIONS.md` is the sign-off surface in full.** At most three cards, each a business
  decision (the filters in `asking-for-decisions.md`), with *Instead of · Because · Locks
  in* (a public name a decision fixes is named in its *Locks in*); the tree; *Decided, not
  asked* (the obvious calls, and the implementer-level ones that hold the direction);
  *Considered and dropped* (the simpler approach considered, and why it lost or won);
  *Open / Settled*, with every POC result; *How it got here* with the draft line. Size —
  read off *what changes* and the debt table — goes on `SPEC.md`'s facts line, written last.
- **When the change introduces or tightens an invariant** — a cap, a guard, a uniqueness
  rule, a graded property — `DECISIONS.md → Decided, not asked` names its **convergence
  point** and every writer or producer that must pass through it, including legacy helpers
  and pattern-internal construction sites (tenet 5). An invariant enumerated at one entry
  point is the most expensive review class we have: the reviewer ends up finding the other
  writers for you.
- **The Step 3.5 verdict shapes `SPEC.md` and `DECISIONS.md`.** A "refine the substrate" or
  "build smaller" verdict changes what the people table promises and what the cards argue
  for — reflect it there, don't bury it.
- **The figures are drawn here; Step 6 renders and verifies them once before publishing.**
  The *how we'll know it's met* and *what changes* figures are not optional; the rest are drawn where position carries the
  meaning ([`spec-figures.md`](../../../docs/contributing/spec-figures.md)).

### Step 4.5: Analysis — is this the right work?

Dispatch a **fresh `general-purpose` sub-agent (Opus)** — not you; you already chose the
direction — to run [`analysis`](../analysis/SKILL.md) at spec altitude. Give it the drafted
`SPEC.md` and `DECISIONS.md`, the Linear issue, the returns from Agents C and D, your Step 3.5
answers (question 7's job list included), and the epic's retained set if the issue has one.

The analyst runs [`reuse-review`](../reuse-review/SKILL.md) on the *Builds on / Adds* table
for the reuse objective; there is no separate reuse step. A **reuse X** or **extend X** verdict
on an item the spec treated as new is a fold. Don't skip it because Agent E grades the debt,
and don't fold it into a `second-look`.

Dispose of each finding as that skill's Altitude 1 says (fold / record / open). A fold is a
re-draft before Step 5, so validation checks the direction you publish. Write `DECISIONS.md` →
*Analysis* from the return: the date, the watermark, the verdict, one line per objective, and
each finding's disposition, including a clean "right approach". This step costs no review rounds.

### Step 5: Validate the Spec

Validators check `SPEC.md` and `DECISIONS.md` — the diff, the docs line, *what's already here*,
Builds on / Adds, and the debt — against current code/docs, not approved intent alone.

Launch the validation agents in parallel. `reuse-review` already ran inside Step 4.5.

#### Agent E: Technical Validation
Launch a `feature-dev:code-architect` sub-agent to review the spec for:
- Consistency with existing architecture patterns
- A case a person would hit that the people table misses, when it would invalidate the design (every other edge case is the implementer's tests)
- Whether **`SPEC.md`'s diff** is present when the public API surface changes materially — showing the change *in use* (the actual calling code or config a person writes, as a diff against today), not just the signatures — or, when it's skipped, whether the one-line justification is stated and defensible
- Whether **the debt is honest**: an existing primitive, method or prior design the change overlaps that *what's already here* doesn't name; anything the change adds that is debt (a second way to do a job, a shim, a special case, a deferred cleanup) and isn't in the *Adds* row, or an *Adds* item with neither a filed issue nor a permanent-by-design reason; and whether the **Net** verdict follows from the tables
- Any conflicts with the project's architectural constraints (check `docs/architecture/*.md`)

#### Agent F: Scope & Dependency Validation
Launch a `general-purpose` sub-agent to:
- Verify all referenced files actually exist in the codebase
- Confirm blocking issues are accurately represented
- Check if any open PR would create conflicts with the proposed approach
- Validate that non-goals are realistic (not punting critical work)
- Ensure the spec is self-contained enough for an isolated agent session
- Verify the prior-design rows in `SPEC.md → What's already here` against the actual prior
  designs: exact anchors, and whether each is really kept, amended or superseded in part or
  whole. Require what replaces it and what changes for callers where applicable; do not
  mistake dependencies for supersession or demand backfills.
- Check the docs line names real destinations — an extended page exists, a new page's sidebar
  spot makes sense beside its siblings, no obviously affected page is missed (streaming and
  state pages especially) — or a defensible no-impact reason.

#### Agent I: Goal Validation — is it the right goal, and would the check catch a miss?
Launch a `general-purpose` sub-agent **blind to the approach**: give it the Linear issue, the
requester's own words and the epic's goal if there is one, and `SPEC.md`'s goal section. Not
the decisions, the debt section or the POC. An agent that has read the approach grades the goal
against what is being built, which is the undersell this check exists to catch. Ask it:
- **Is the goal the real need, at full size?** State the need in your own words from the
  issue alone, then compare. Name any part of the need the goal leaves out, and whether *smaller,
  and rejected* is actually what the goal says.
- **Is *not done if* complete?** Name any state that would look done and isn't and is missing,
  or say the list is complete.
- **Would the check fail if the goal were not met?** For each leg's signal: what would a hollow
  implementation (the mocked path, the easy input, a downstream workaround) make it report?
  Does *anti-game* forbid that, and does the named control degrade exactly the behaviour the
  goal depends on, on the signal that proves it, not merely on its leg?
- **Can someone run it from the text alone?** A path, a signal with a threshold, an input
  and a control, or a stated reason there is no goal check.

A finding here is fixed in `SPEC.md` before publishing: widen the goal, or keep it and state
the gap as the hardest sign-off line. Never argue it away in the reply.

Address any issues the validators surface. If there are unresolvable questions, add them to the "Open Questions" section.

#### The spec's factual base gets a checker before it gets a reviewer

A spec resting on counted/enumerated facts must ship one executable check that re-derives them, under the owning `poc/<experiment>/`. Run it before publishing and record evidence; retention must not pull it into default production execution or discovery.

**Why it goes here, at Step 5, and not into review.** A hand-derived factual base does not converge by being argued about — each round corrects one number and leaves the ones nobody looked at. One spec ran **thirty-five rounds against a two-round budget**, overwhelmingly on evidence accuracy, and eventually built exactly this checker; it worked immediately. The only spec that cycle to hold its budget had built its evidence before review and used it to **refute the premise the issue was written on**.

Two properties it needs, both learned the same way:

- **A totality assertion, not just a spot check.** A checker that verifies the sites it knows about cannot report the one nobody listed. The corpus checker that caught the most was the one asserting *every* tracked file is classified as in-scope or deliberately out.
- **A negative control, run.** The first version of that assertion silently passed a planted unclassified file, because a subtree rule absorbed it — *the exact failure the assertion existed to prevent, inside the assertion*. Plant something the check must reject, watch it fail, then remove it. A green check you have never seen go red is not evidence (tenet 7).

Skip it when the spec rests on no counted facts, and **say so in one line** rather than leaving the omission silent. Where a single disputed behavioural claim is the issue rather than a whole factual base, that is `settle-claim`'s job, not this one.

### Step 6: Publish the spec — ready spec PR + Linear links

Publish canonical content in the repository; Linear carries status and links, not a second edited copy.

1. **Write `specs/issues/<ISSUE-ID>/`** with `SPEC.md`, `DECISIONS.md`, and authored artifacts per
   [`spec-template.md`](../../../docs/contributing/spec-template.md). `DECISIONS.md → How it
   got here` carries one entry: `- **Draft** — <one line: how the problem is framed, the
   approach chosen, and what it builds on>.` This directory is the canonical reviewable
   artifact.

   **The people table is the first content in `SPEC.md`**, directly under the title and the
   nav line — structural navigation is exempt — with no metadata, status block, or timeline above
   it (BP-039); the metadata goes on the facts line at the end. The goal section follows it. *How it got here* is the change story and sits at the bottom of
   `DECISIONS.md`; it never leads.

2. **Draw, render and check the figures** before the commit — the *what changes* figure, a
   **trade-off figure per decision on `SPEC.md`'s sign-off** and per live fork (none for a card the filters sent to the engineering block), and,
   unless the spec states that no goal check applies, the *how we'll know it's met* fence at least, the rest where position carries the meaning
   ([`spec-figures.md`](../../../docs/contributing/spec-figures.md)). Run its verify block
   over the directory and open every rendered SVG in both themes. A figure nobody looked at
   is how a wrong one ships, and a figure is what the gate actually looks at.

   For a spec whose whole answer is *don't build this* — a fold, a close, a scope cut —
   the decision tree is the figure that earns the set: where each half of the issue went,
   and anything the spec found that nobody owns.

3. **Open the spec PR ready for review.** Get onto `spec/<ISSUE-ID>` — and **which command depends on whether Step 4 already created it for a POC**, because the create form resets the branch:

   - **No POC (the common case): create it** on fresh `origin/main` — worktree-safe, so it's correct whether you're in the coordinator's checkout or a worktree spun off it (see [`orchestration.md`](../../../docs/contributing/orchestration.md) → Worktree branching): `git fetch origin main && git checkout -B spec/<ISSUE-ID> origin/main`.
   - **Step 4 built a POC: the branch already exists and carries commits. Do NOT run the line above** — `-B … origin/main` resets it, discarding every POC commit and leaving `DECISIONS.md → Settled` and the POC block pointing at files that aren't in the PR. You are already on the branch in the same worktree, so just verify it (`git branch --show-current`) and commit onto it; if you somehow aren't, check it out **without** re-basing on main — `git checkout spec/<ISSUE-ID>` (or `git fetch origin spec/<ISSUE-ID> && git checkout -B spec/<ISSUE-ID> origin/spec/<ISSUE-ID>` if it was already pushed).

   Then commit the directory, push, and open a PR titled `spec(<ISSUE-ID>): <issue title>` **ready for review** (not a draft) with `create_pull_request`. **Label the PR `spec`** so spec PRs stay filterable and the orchestrators can find them by label (create the `spec` label in the repo if it doesn't exist yet).

   **Write the PR description to [`spec-template.md`](../../../docs/contributing/spec-template.md) → "The PR body"** — the instance — under the rules in [`pr-reviewer-guidance.md`](../../../docs/contributing/pr-reviewer-guidance.md) → "The layout". Don't restate them here. What's specific to a **spec** PR:

   - **Language: ASD-STE100.** Write every line of prose in the body in Simplified Technical English, per [`pr-reviewer-guidance.md`](../../../docs/contributing/pr-reviewer-guidance.md) → "Language — ASD-STE100". Text you cut from `SPEC.md` gets rewritten to STE, not pasted. What is exempt is that section's list, not restated here.
   - **The people table**, cut from `SPEC.md` to five rows, is blocks 1 and 2. **The goal**
     follows it: its sentence, the *how we'll know* mermaid fence with its sentence, and one
     line naming the goal check and the control that must fail (or, when no goal check
     applies, the one line saying what proves the goal instead). **The *what changes* figure** goes under it as a raw-content image pinned to the commit that holds it, with its one sentence ([`spec-figures.md`](../../../docs/contributing/spec-figures.md) → "In the PR body"); then one line on **how**. Read the stored body back ([`spec-figures.md`](../../../docs/contributing/spec-figures.md) → "In the PR body"). A `src` with no backtick renders, and a later edit keeps it. If the `src` comes back with a backtick in it, leave a link to `SPEC.md`'s blob view in its place and hand the person the clean `<img>` line — the line you sent, not the stored one — and never rewrite a body a person has pasted into.
   - **`## Sign off`** ← first the goal, then the debt, unnumbered, each with *If wrong:* — the debt line is `SPEC.md`'s **Net** verdict with what it adds and removes in a clause; then the decisions in `DECISIONS.md`, **sorted and shaped per [`pr-reviewer-guidance.md`](../../../docs/contributing/pr-reviewer-guidance.md) → §3** in its compact form — per decision a subheading stating it, its **trade-off figure** pinned like the *what changes* figure, and one line naming the row it came down to and *If wrong:*; hardest first, the one to weigh named, a link to `DECISIONS.md`. Read each stored `src` back the same way. Two things are spec-specific: every decision the filters drop goes one bullet each in the collapsed **engineering calls** block, so the sign-off surface stays complete and nothing is approved unseen; and **every open question in `DECISIONS.md → Open` is a live fork** and gets the full six-part ask per [`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md), above the ratified lines.
   - **Count decisions and open questions together against the ceiling of three.** The goal's
     and the debt's sign-off lines are not decisions and do not count: they are what approval
     already certifies ([`orchestration.md`](../../../docs/contributing/orchestration.md) → the
     bar), stated so the size and the net are visible. When the smaller goal is what ships, that is a live fork and it counts. If the combined total exceeds three, fix the upstream spec rather than lengthening the ask. Keep Linear pointed at the current review artifact.
   - **Analysis, one line** under the sign-off: the verdict and what it changed, linking `DECISIONS.md` → *Analysis*.
   - **`## Reviewers · look here`** — one to three items, each naming the document and the question, plus what is deliberately not here.
   - **The links line** — the two documents, Linear, the epic, predecessors, and the spec merge contract.
   - **The collapsed contract** — `## How to review this` from [`spec-template.md`](../../../docs/contributing/spec-template.md), pasted **verbatim**. Smoothing it weakens the only instruction an external bot ever receives, and no spec PR ships without it. A second collapsed block, **engineering calls**, only when the filters dropped a decision.
   - **Budget:** the spec-PR row in [`writing-for-humans.md`](../../../docs/contributing/writing-for-humans.md) → Budgets. **The figures that row's budget anticipates are *how we'll know*, *what changes*, and one trade-off per sign-off decision** — any other has to earn it.
   - **If a Step 4 POC was built**, add a collapsed POC block: one runnable command per artifact, the question it answers, and that it's throwaway.

   Review the set through the committed diff rather than duplicating it in the PR body. The spec PR is separate from implementation and needs no changeset. Fuller examples belong in owned `assets/` or isolated `poc/<experiment>/`, linked from the prose.

   **`<details>` belongs in the PR body, not the spec documents.** The document split supplies navigation.

4. **Link from Linear.** Attach the spec PR and canonical directory; update an existing pointer rather than publishing a full-content mirror. After merge, point to the retained set on `main` while keeping the original review PR.

5. **Update issue relations and comment**:
   - Add/update dependency relations discovered during research (`save_issue` with `blockedBy` / `blocks`).
   - Add a short, problem-first publishing comment with the review ask, open decisions, and links to the spec and PR. Do not copy the full spec or maintain a second set of sign-off prose in Linear.
   - If open questions exist, flag the issue for discussion.

6. **Keep links current, not duplicate content.** Before merge, review edits go to the review head. After merge, use a follow-up PR from `main`; never reopen or push the original. Material direction changes require fresh human approval.

7. **Move the issue to "In Spec Review"** after the repository set, PR, and Linear links are ready. Use the closest equivalent if the team lacks that state and note it.

### Step 6.5: Respond to spec-PR review

The spec PR draws code-tuned bot review we can't instruct. **Triage against the bar, don't negotiate.**

Read [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Spec review: the bar and the convergence rule" first; it is canonical for the bar, the dispositions, and the budget. This step is how you execute it.

**First resolve the PR state.** For an unmerged review PR, fetch and check out its actual head without resetting it to `main`. For a merged original, start a new amendment branch from fresh `main` and open a follow-up PR; never reopen or push that original branch. Read the current retained set and intervening amendments first: `SPEC.md` and `DECISIONS.md` (a set retained in the older shape may also carry `BUSINESS-RULES.md`, `PLAN.md`, `DOCS.md` or `EVOLUTION.md`; read those too, and keep its shape rather than re-drafting it into this one). Review notes go in `DECISIONS.md → Notes from review`; only an older-shape set keeps them in its own `PLAN.md → Notes from review`.

#### 6.5.1 Triage every comment — one disposition each

For each piece of feedback ask the only question that matters at this altitude: **does acting on this change the approach?** Then pick exactly one:

- **Fold in (spec-level).** The approach, decision, debt verdict, or scope are wrong or incomplete. A `reuse-review` verdict of reuse X or extend X on an Adds item treated as new is this disposition. Re-draft the affected documents per 6.5.2 and reply on the thread; keep Linear links current, not a content mirror.
- **Note for the implementer (the default).** Everything below that line: naming, file layout, local structure, which helper, error-message wording, a micro-optimization, a test-name preference, "have you considered X *here*", or a detail the spec left to the implementer on purpose. Record it **verbatim** in **`DECISIONS.md → Notes from review`**, and reply once saying it's recorded for implementation rather than baked into the design. **Do not rewrite the design prose around it** — that pretends the spec can settle something it can't, and it's what turns a sound spec into a churning one.
- **Drop.** Already answered in the spec · out of the issue's scope · a preference with no defect behind it · a factual error about the codebase. Reply once with the pointer or the correction. No spec edit, no review note.
- **Settle (empirical dispute — only once a loop has formed).** A **factual claim about how the system behaves** — "a router can't do that", "the store won't preserve ordering there", "that capability doesn't compose with a sequencer's state" — that has now been **asserted and counter-asserted at least twice**, where the spec's approach *depends* on it and running code can decide it. You can't fold it (you'd be guessing which side is right) and you can't note it (the approach rests on it), so **settle it with a POC** — see 6.5.3. **Requesting a settlement costs zero review rounds**, and the spec keeps converging while it runs.

**Settle on the loop, not on the assertion**: a claim asserted once is ordinary triage. The trigger is canonical in [`orchestration.md`](../../../docs/contributing/orchestration.md) → "When it fires".

**The default is Note, and the burden of proof is on folding.** If you can't name which decision card or which part of the approach changes, it isn't spec-level. The one cheap exception: genuine factual corrections and broken references get fixed inline without ceremony — they don't move the design, so they don't cost a round. Any correction, inline or folded, still owes its echoes: before the push, run [`issue-implement`](../issue-implement/SKILL.md) 10.6's word and surface sweeps over every claim you corrected, and report both.

A note is how a good observation reaches the implementer, not a deferral, and ten below-the-bar comments are not one spec-level problem. A repeated below-the-bar point needs no new answer.

**Escalate genuinely debatable feedback to the user.** When a suggestion is *spec-level* and both the reviewer's and the spec's positions are defensible — a scope change, a reversed decision — don't silently accept it: surface it as a decision they can make, in full — all six parts, per [`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md). **Recommend**; you have researched this and they haven't. `AskUserQuestion` gets a crisp choice; the framing still has to be there. Relaying the reviewer's wording is not an ask — it hands them a debate instead of a decision. This is for direction forks only; a below-the-bar comment is never worth a user prompt.

#### 6.5.2 Re-draft, don't append — the anti-addenda rule

**The figures are surfaces a re-draft reconciles.** A folded finding that moves the approach
moves whichever figure drew it — the decision tree, the *what changes* figure, a decision's
trade-off — and a figure still showing the superseded shape is the defect this rule exists to prevent:
worse than stale prose, because a figure is what the gate actually looks at. Feedback that
changes only wording moves no figure: below the bar is below the bar. Re-render and re-run the
[`spec-figures.md`](../../../docs/contributing/spec-figures.md) verify block on any figure you
touch. **The people table and the sign-off in `SPEC.md` are surfaces too** — a card that
changed and a sign-off line that didn't is the same defect.

**Canonical; `issue-implement` 10.6 points here.** Re-draft when direction changes or the artifact grows beyond ~1.3× its opening/last-redraft size (cumulative, not round-over-round). A `Re-draft:` trailer records that baseline. Rewrite affected sections into one coherent account, not a contradictory addendum; reconcile every affected section, including the docs line, *what's already here, and the debt*, and figures. Keep Linear links current, not a content mirror. Record a direction pivot in `DECISIONS.md → How it got here` with its reason; growth-only redrafts and review notes do not earn a pivot. After merge, use a new amendment PR and renewed approval for material direction changes. **After a fold that moves Adds or *What's already here*, re-run [`reuse-review`](../reuse-review/SKILL.md) on the new head before pushing.**

#### 6.5.3 Settle an empirical dispute with a POC (non-blocking)

When triage lands on **Settle**, the debate stops and a throwaway POC decides it.
**[`orchestration.md`](../../../docs/contributing/orchestration.md) → "Settling a disputed claim
(POC settlement)" is canonical** — when it fires, the claim-slice shape, what it costs, the
three outcomes. Read it. Four things are this step's:

1. **Try the two cheap outs first.** *The answer is in the repo* — the code, its tests,
   `docs/architecture/*`, an existing `goals/*/*/goal.md` — so reply with the citation (a
   **Drop** with a pointer) and dispatch nothing. Or *the claim is already settled on this
   spec* — `DECISIONS.md → Settled` carries it with evidence — so reply once pointing there and
   **charge zero rounds**. A settled claim is closed; re-litigating it, by a bot or a human or from a novel
   angle, does not reopen it.
2. **Write the claim slice** (`claim` · `load` · `falsify` · `threads` — the shape in
   `orchestration.md`). If you can't fill `falsify`, this isn't empirical: route it as a
   direction fork instead.

   **Record the claim in `DECISIONS.md → Open` marked `(POC in flight)`.** This tells the reviewer and implementer which premise is being tested. Before merge it is part of the reviewed head; after merge, recording or resolving it uses a follow-up PR from `main`. It never permits implementation before spec merge or amendments on the original merged PR.
3. **Dispatch or request, depending on whether you'll outlive the answer.** Standalone, you
   own your session: dispatch the **`poc-agent`** yourself and keep triaging while it runs —
   collect the verdict *if it returns before you close the round*, and otherwise disclose it
   as in-flight and close the round anyway. As a **bounded worker** under a lifecycle you exit
   at the end of this step, so the verdict would have nowhere to land: return the slice as
   `settle_requested` and let the coordinator dispatch it. **Either way you never hold the
   round open waiting** — the POC gates nothing.
4. **Route the verdict into the spec** (the part `orchestration.md` leaves to the artifact):

   - **CONFIRMED** → reply on the thread; record it in **`DECISIONS.md → Settled`** as
     resolved-with-evidence. No spec rewrite, and **no** *How it got here* entry — nothing
     changed, same rule as a review note.
   - **REFUTED** → re-draft the affected documents per 6.5.2 on the current review PR or a post-merge amendment PR, reply,
     record in `DECISIONS.md → Settled`, and add one *How it got here* line: `- **POC
     settlement** — <what changed>, because the run showed <what>.` Costs **one round outside
     the budget**; say so in one line.
   - **INCONCLUSIVE** → don't retry and don't pick a side. Surface it to the user as a
     direction fork asked **in full** (`AskUserQuestion`) — all six parts, per
     [`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md). You ran the
     POC and they didn't, so say what it did and did **not** settle, and still give a
     recommendation where the direction has one that doesn't rest on the unsettled claim. If it
     genuinely has none, say that outright — "no recommendation, and the POC is why" is an honest
     answer here and is not the same as quietly leaving the part out.

#### 6.5.4 Converge — two rounds, then hand to the human

**Default budget: two rounds** (a *round* = one pass over the feedback outstanding since the last push). After round two the spec has converged: say so, and present it for the approval gate with any remaining open threads carried as review notes in `DECISIONS.md`. Spend a third round **only** when round two surfaced a genuine spec-level finding — a new approach question, not more notes — and state that in one line so the extra round is a visible decision rather than drift.

**Convergence is not a check bypass.** Do not spend new design rounds chasing below-the-bar nits, but satisfy required repository checks and review-thread policy before spec merge. Approval never waives them. Why converging is safe, even with a settlement in flight: [`orchestration.md`](../../../docs/contributing/orchestration.md) → "The convergence rule".

A bot `CHANGES_REQUESTED` does not supply or revoke human direction approval or extend the design budget. Required repository review and thread policy still governs merge; report a blocked merge rather than bypassing it.

#### 6.5.5 Sign-off

Human sign-off approves the reviewed head, not future revisions. The owner merging the spec PR is itself sign-off, with no label or comment needed; the merged head is the approved one. Follow [`orchestration.md`](../../../docs/contributing/orchestration.md#gates-direction-approval-then-confirmed-merge) → Gates and "Merging and amending a spec": no self-approval, no standing label approving a changed head. After approval and required checks, merge the spec and confirm the merge before implementation. If checks or required threads block merge, report that wait. Material amendments need renewed direction approval; implementation PR merge remains a separate human gate.

### Step 7: Reframe the Issue Description

This step is required, not optional. The spec now exists as the authoritative source of *how* — so the issue must be reshaped to be the authoritative source of *what* and *why*. Even issues that already look "fine" usually need pruning: details that were appropriate before the spec existed are now duplication.

**7.1. Diff the existing issue description against the spec.** Read the current description carefully and classify every section/bullet as one of:

- **Keep in issue** — problem statement, motivation, user/business value, desired outcomes, high-level scope boundaries, success criteria expressed as observable outcomes (not implementation), stakeholders, links to related issues/projects.
- **Move to spec** — architectural decisions and the public names a decision locks in. If any of this is in the issue and *also* in the spec, delete it from the issue. If it's in the issue but *not* in the spec, first verify whether the spec's approach actually covers it; if so, delete from issue; if not, that's a gap in the spec — go fix the spec. File paths, other signatures, sequencing, test strategy, error taxonomies and schemas are the implementer's: delete them from the issue without porting them into the spec.
- **Stale / contradicted** — implementation detail in the issue that conflicts with what the spec decided. Delete from the issue. Do NOT silently rewrite it to match the spec; the issue is not the place for that detail at all anymore.
- **Reframe** — content that gestures at a solution but is really expressing a constraint or outcome. Rewrite it as the underlying outcome. Example: "Use Redis for the queue" → "Queue must survive process restarts and support multiple workers."

**7.2. Rewrite the issue around the PM/business/user lens.** The reshaped description should answer, in this order:

1. **Problem / opportunity** — what's broken, missing, or worth doing, in plain language a non-engineer stakeholder could follow.
2. **Who benefits and how** — the user (end user, developer using the framework, operator, internal team) and the value they get. Be concrete; avoid "improves DX" without saying *what specifically gets better*.
3. **Desired outcome / success criteria** — observable, testable outcomes. "Resuming a stream after a disconnect delivers no duplicate items and skips no items" is good. "Implement sequence-based resume in `sse.ts`" is not — that's solution.
4. **Scope boundaries (high-level)** — what's in vs out, expressed as outcomes, not file lists. Phase split if relevant.
5. **Link to the spec** — a blockquote at or near the top: `> **Implementation spec:** [link]`. This is the pointer for any reader who wants the *how*.
6. **Dependencies** — only at the level of "this is blocked by FSD-XXX" or "ships after the X work lands." File-level coupling lives in the spec.

**7.3. What to leave out of the issue:**

- File paths, package names, function signatures, type definitions
- Step-by-step implementation sequences
- Test plans (mention testability outcomes only — e.g., "must be covered by integration tests" if that's a stakeholder requirement, but not the test list)
- Code snippets or pseudocode
- Architectural decisions and their justification
- Anything labeled "design" or "approach" — that's spec territory
- Long checklists of work items (the implementer plans the work; the issue's acceptance criteria should be outcome-shaped, not task-shaped)

**Note for borderline issues.** Not every issue warrants a separate spec document. If the work is small enough that the full issue-spec workflow would be overkill but still requires agent-ready clarity, the **agent-brief template** at `docs/contributing/agent-brief-template.md` is the right shape for the issue body itself. In that case you're not running issue-spec at all — the brief IS the contract. Use issue-spec when the implementation needs research, multiple sub-agents, or decisions someone has to sign off; use the agent-brief template directly when the issue fits on one screen and the contract is local.

**7.4. What's legitimately allowed to stay even though it's specific:**

- Concrete success criteria that happen to mention public API surface a user will see (e.g., "users can call `defineCapability({...})` to declare a reusable capability") — this is *what users get*, not *how it's built*.
- A short "Documentation Deliverables" line if the project requires it for user-visible features. Keep it short — the spec's docs line names the destinations.
- Performance, latency, or compatibility targets — these are outcomes.

**7.5. Apply the update** with `save_issue`, replacing the description. If the existing description had content worth preserving for archival reasons (e.g., a historical decision thread), put that in a comment rather than the live description so the description stays clean.

**7.6. Note the reshape in the publishing comment** added in Step 6.4 — extend it with: "Issue description reframed: [one-sentence summary of what was moved out / what now leads]." This gives reviewers a heads-up that the issue text changed shape, not just content.

### Step 8: Present Summary

Present the ready spec PR for human direction review, including the docs line and the debt verdict. Explain that approval authorizes merging that reviewed spec after required checks, then implementation; it does not authorize merging the later implementation PR.

1. **Necessity & refinement verdict** (one line): "Build as scoped", "Refine the substrate — <primitive> covers it", or "Build smaller — dropped <X>." Surfacing this in the summary lets the user see that Step 3.5 actually ran and what its outcome was; future readers can audit whether the gate worked. If the verdict was anything other than "Build as scoped," you will not have reached Step 8 without user confirmation — note that confirmation here too.
2. **`SPEC.md`'s goal, people table and sign-off**: paste them verbatim, **leading with the table, then the goal sentence and its check line** (BP-039) so the user gets the gist before any dense detail. This is the same scan-first surface the spec PR body leads with (Step 6, item 3) — the user should see exactly what they'd see opening the spec. If you find yourself rewording it for the summary, `SPEC.md` itself is wrong; fix it in the spec and then paste here. Link the *what changes* figure; a chat can't carry it.
3. **Approach chosen**: 2-3 sentences on what the spec proposes and why
4. **The debt and the decisions**: the debt line first (net down, flat or up; what the change adds and removes; the filed issue that pays each added item not permanent by design), then the decision sign-off lines, each linking its card in `DECISIONS.md` — the decision, what it rejected, what it locks in are one click away. This is what the user reviews to sign off on the direction, not just the code. **Two or three decisions is normal** — a longer list usually means mechanical calls leaked in, and those belong in `DECISIONS.md → Decided, not asked` or to the implementer, not here ([`spec-template.md`](../../../docs/contributing/spec-template.md) → `DECISIONS.md`).
5. **Docs line**: quote it — the destinations and their operations, ownership under an epic, or the justified no-impact reason.
6. **Issue reshape summary**: one or two sentences on how the Linear issue description was reframed — what implementation detail was moved out, what now leads, and whether anything was found stale/contradicted. If the issue needed no reshape because it was already PM/business-shaped, say so explicitly.
7. **Dependencies identified**: what must land before this can start
8. **Open questions**: anything that needs the user's input before implementation (including any open docs-placement questions)
9. **Links**: the Linear issue, the spec document, and the spec PR

**Write this for a product owner, not a peer engineer.** You are the engineer; they set the objectives and track the process as a whole. Items 3, 4 and 8 get stated in observable behaviour and priced in consequences — customers, promises, timing, reversibility — not in files, symbols, or framework vocabulary.

If there are open questions, **ask them properly** — all six parts, per [`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md) (canonical, with a worked example). Batch them under one `Need your sign-off` heading, numbered, hardest first — zero to two is normal; more than that and the direction isn't ready for review. Once resolved, update the spec document with the decisions.

## Guidelines

- **Depth over speed *in authoring*; convergence over exhaustiveness *in review*.** Authoring is a research task — spend the time, because a thin spec is worse than no spec (it gives false confidence). Review is the opposite discipline: the spec is already researched, and the job is to confirm the direction and stop. Depth up front is what *earns* a short review.
- **Be directional, and don't apologize for it.** The spec fixes the direction; the implementer owns the plan. A reviewer pointing at an unsettled line-level detail has found something the spec left open **on purpose** — that's a review note, not a gap to close.
- **Be specific about direction, not signatures.** "Update the server" is not a spec. "Resume an SSE stream by filtering out items below the caller's last-seen sequence number, at the streaming seam" is — it names the actual behavior and where it lives without pinning the exact signature or file path (those are the implementer's).
- **Show the code in use, not just the contract.** When the change materially alters the public API surface, **`SPEC.md`** must carry the diff — the actual code or config a developer writes against the new or changed surface, as a diff against today — not only the signatures. Skip only when nothing about how code is written against the framework changes (internal refactor, pure type/schema change, config or build plumbing, a bug fix that restores documented behavior), and say so in one line.
- **Follow existing patterns.** The codebase has established conventions. The spec should extend them, not invent new ones. When deviating, explain why.
- **Research is not copying.** Industry research informs the approach but the implementation must fit this codebase's architecture, not blindly adopt an external pattern.
- **Self-contained.** The spec must carry everything the implementer needs to hold the direction — the goal, the decisions, the debt verdict — without re-deriving it. If they have to read 5 other documents to understand the spec, it's not done.
- **Non-goals matter.** Explicitly stating what you're NOT doing prevents scope creep and sets expectations.
- **Documentation is part of the spec, not an afterthought.** Every spec names where docs change — the docs line in `SPEC.md → What changes` — with a real answer, including "no documentation impact" with the reason. Never leave it as a vague bullet like "update the README" or "docs later." Which surfaces, extend or new page, and sidebar placement are decided at spec time, while the context is there; the prose is written at implementation, against what shipped.
- **Reframing the issue is part of the spec workflow, not a post-script.** Step 7 is required. The moment the spec is published, any solution detail still living in the issue is duplicate or stale. Removing it preserves the issue/spec separation and prevents future readers from following the wrong source. Do not skip it because the issue "looks fine" — re-read it through the PM/business lens and prune.
- **Open questions are OK — but never neutral.** It's better to flag uncertainty than to make a wrong assumption. Present the fork in full ([`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md)), **recommendation included**: options and trade-offs alone hand the owner an unpriced menu and cost a round while they ask what you think. You did the research; they didn't. See [`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md). And a question you'd answer the same way whatever they said isn't open — decide it and make it a decision card.
- **Dependency accuracy is critical.** If you say "no dependencies," an agent will start building immediately. If there's actually a dependency, the work gets thrown away. Be thorough.
- **Push back when you should.** Your job is not to produce a spec on every issue; it is to produce specs for the issues that warrant them. When Step 3.5 surfaces a wrapper-over-primitive shape, single-vendor leakage into framework surface, or a precedent-mirror that doesn't transfer semantically, the right deliverable is a concise case for *not* shipping and one or more proposed alternatives. The user can override — but you have to actually present the case. A spec the user later cancels is more expensive than five minutes of "should we even build this?"
