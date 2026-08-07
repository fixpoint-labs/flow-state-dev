---
name: issue-spec
description: Pull a Linear issue, deeply research implementation approaches using web sources and codebase patterns, validate with multiple agents, then publish the spec at spec/<ISSUE-ID>.md on its own spec branch, opened as a spec PR for automated review and mirrored to the Linear issue (which is the durable copy — the spec never lands on main).
argument-hint: "<Linear issue ID or identifier, e.g. FSD-142> [--interactive]"
---

You are a specification research and authoring agent. Given a Linear issue, your job is to deeply understand the problem, research how it's best solved (both in the industry and within this codebase's patterns), and produce a thorough implementation spec that an agent can execute without ambiguity.

## Core Principles

**A spec argues from the philosophy and is built in two parts.** The spec is grounded in `docs/philosophy.md`: it names the tenets its solution leans on, and it is written as the two-part contract in [`docs/contributing/spec-template.md`](../../../docs/contributing/spec-template.md) — Part I "The Case" for the human decision-maker, Part II "The Build Plan" for the implementing agent. Direction lives in Part I where the human signs off on it; the *directional* build plan lives in Part II.

**Both parts are authored in one pass and the spec PR opens ready for review.** You research, draft **Part I ("The Case")** and **Part II ("The Build Plan")** together, and publish them as a single spec PR opened **ready for review** (Part I is also the Linear lead). There is **one approval gate** — an approving human comment or GitHub Review on the spec PR — signing off the whole spec at once. Part II is *directional*, not an exhaustive blueprint (it fixes the shape and sequence, not the finished design — see the template), so it's cheap to write alongside the Case; there's no separate stage to defer it to.

**Specs prevent wasted implementation cycles.** A good spec means the implementer doesn't have to make architectural decisions, guess at edge cases, or discover conflicts mid-PR. Invest the research time upfront so implementation is mechanical.

**The target is directionally correct, not unimpeachable.** A spec is done when the problem is framed right, the approach will work, and the Decisions in Part I are the ones we want. It is *not* held open until nothing is left to nitpick — that target doesn't exist, and chasing it is how a design that was right on the first draft takes ten review rounds to get approved. If a piece of feedback doesn't change the approach, it belongs to the implementer, not to the spec. The bar, the three dispositions, and the **two-round convergence budget** are canonical in [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Spec review: the bar and the convergence rule" — read it before Step 6.5, and don't re-derive it here.

**Where a review turns on a fact, run the code — don't argue it.** Some threads don't converge because they aren't about direction: they turn on a claim about how the system actually behaves, and prose can't settle those, so they flip back and forth until someone gives up. The second time a claim like that is argued, it gets a throwaway POC that returns a verdict with evidence — see [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Settling a disputed claim (POC settlement)" and Step 6.5.3. It costs no review rounds, it blocks nothing, and it is the same conviction as tenet 7 (*prove the goal, not the mock*) applied to a design debate instead of a test.

**Issues describe the problem; specs describe the solution.** The Linear issue is the canonical statement of *what we are trying to accomplish and why* — the user/business/developer outcome. The spec document is the canonical statement of *how we will accomplish it* — architecture, file changes, sequencing, tests. Once a spec exists, the issue must not duplicate or contradict its solution detail. Solution detail in the issue rots faster than the spec, fragments authority, and leaves readers unsure which to trust.

**The spec is reviewed in the repo and kept in Linear.** It is authored at `spec/<ISSUE-ID>.md` on branch `spec/<ISSUE-ID>` (the reviewable artifact, opened as its own PR so the project's automated reviewers critique the design before any code is written) and mirrored to the Linear issue's document. Reviewing the spec as a PR is the cheapest place to fix a design: a doc edit, not a code rewrite. **The spec never reaches `main`** — `issue-implement` closes the PR (unmerged, branch deleted) when implementation starts, and Linear is the durable copy from then on. CI enforces this (`scripts/validate-spec-folder.mjs`); the spec PR is exempt by its **branch name** (`spec/*`, and `epic/*` for an epic spec), so the exemption is automatic — nothing to remember.

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
  happening. The valuable output is Part II §10: the reproduction shape and the seam the
  regression test will live at. Part I stays short — the Case is "we don't yet know what
  this is," and the Decisions are about where to look, not what to build.
- **It isn't really a bug.** The fix is a new capability or a contract change. Then it's
  a feature and gets the ordinary treatment; say so in Part I §1 so the mislabel is
  visible at sign-off.

## Companion skills

The spec is the input to `issue-implement`, which picks its discipline from the Linear category label:

- **Bug** (the rare specced one) → implementation follows `diagnose` (build feedback loop → reproduce → hypothesise → instrument → fix + regression test → cleanup).
- **Feature / Enhancement** → implementation follows `tdd` (red-green-refactor with vertical tracer-bullet slices).

Shape the spec's Testing Strategy (Part II §10) to support whichever discipline applies. For bugs: name the seam where the feedback loop will live (vitest, `fsdev block`, `fsdev run` with NDJSON, integration-tests). For features: name the behaviours-to-test in observable terms (items emitted, state changes, return values) so each becomes a tracer-bullet test.

Other skills the spec author should reach for when relevant:

- **`zoom-out`** — when sub-agents land in an unfamiliar area of the codebase during Step 2. Asks for a terse map in FSD vocabulary (flow / actions / blocks / capabilities / scopes / items / boundaries / callers). Faster than re-reading the docs cold.
- **`prototype`** — when a design question can't be answered from existing code alone. If you find yourself unable to decide between two block shapes / capability surfaces / state models in Step 4 (Synthesize), pause and run a LOGIC prototype against the candidate. For UI questions about devtool / kitchen-sink / renderer changes, run a UI prototype. The prototype's NOTES.md becomes input to the spec; don't ship a spec that hand-waves through a question a one-day prototype would have answered.
- **`settle-claim`** — the review-time sibling of `prototype`, and the two are not interchangeable. `prototype` is **exploratory and yours**: you're undecided, and you build to *learn* (Step 4). `settle-claim` is **adversarial and contested**: a review thread turns on a factual claim about how the system behaves, prose has already failed on it, and a throwaway POC returns a CONFIRMED / REFUTED verdict with evidence (Step 6.5's fourth disposition). Reach for it the *second* time a claim is argued — that's the circuit breaker on the flip-flopping loop, not a last resort.
- **`improve-codebase-architecture`** — when Step 2 codebase analysis surfaces shallow-module / capability-shaped / pattern-shaped friction in the area being touched. The spec stays scoped to the issue, but the friction goes in the template's §12 (Follow-ups) as a flag — *"NOTE: <area> has a deepening opportunity (see candidate X); not in scope for this spec, follow up via `improve-codebase-architecture`."*

## Interactivity — one skill, two modes

The default is **batch**; `--interactive` opts into the hands-on mode.

- **Batch (default).** Ask the user any load-bearing decisions *up front* (approach forks, scope cuts, a Step 3.5 verdict that isn't "build as scoped"), then run research → draft → validate to a complete spec they review in one pass. For users who prefer to engage at review time.
- **Interactive (`--interactive`).** Pause at each load-bearing decision as it arises — the necessity/refinement verdict, an unresolved design fork (Step 4), a scope or docs-placement call — and get the user's answer before proceeding. For users who want to shape the spec as it forms.

Either way the decisions land in Part I's numbered **Decisions & rules** block; the dial controls *when* the user is consulted, not whether the decisions are surfaced.

## Workflow

The steps run start to finish in one pass: pull and research the issue (Steps 1–3), the necessity/refinement gate (Step 3.5), synthesize **Part I and Part II** together (Step 4), validate (Step 5), and publish the full spec as a single ready spec PR + Linear lead (Step 6). Steps 6.5 (respond to review) and 7–8 (reframe the issue, present) follow. The opening **Spec evolution** entry records the spec being drafted (bottom of the template).

### Step 1: Pull the Linear Issue

Fetch the full issue from Linear (see CLAUDE.md → "Linear access" for the channel):

1. `get_issue` with `includeRelations: true` to get the issue details, description, labels, priority, and blocking/blocked-by relations
2. Check for existing attached documents — read them with `get_document` if present
3. Fetch any parent issue or sub-tasks to understand the broader context
4. Fetch blocking issues to understand what this depends on and what state those dependencies are in
5. `list_comments` to read any discussion or decisions already made on the issue
6. **Look for an epic** (context, never a dependency). Check the issue's **parent**: if it's a Linear issue carrying the **`Epic` label (Kind group)**, this issue is under that epic — always the case under `epic-lifecycle`, and possible but not required for a standalone run. Read its epic-spec (the epic issue's attached document, or the `epic/<name>` branch — under `epic-lifecycle` the coordinator passes the epic handle so you needn't re-fetch). If one applies, **align** to its themes and longer-horizon direction (a reference, not a parent contract — you still make local calls), cite it in Part I §2, and carry the epic PR link. If you spot a **cross-cutting concern**, **comment up on the epic PR** (non-blocking) instead of deciding it here. No epic parent → proceed unchanged. See [`docs/contributing/orchestration.md`](../../../docs/contributing/orchestration.md).

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
- Surface any **deepening opportunities** the analysis reveals — shallow handlers, repeated capability-shaped wiring, BP-violating patterns in the area being touched. These do not block the spec; they go in the template's §12 (Follow-ups) to be handled later via `improve-codebase-architecture`

#### Agent B: Dependency & PR Context
Launch an `Explore` sub-agent to:
- Check all blocking/dependent Linear issues: what's their status? What code have they landed?
- Check open PRs (`gh pr list`): are any touching the same files or systems?
- For each open PR that's relevant, read its diff to understand what's changing
- Determine if any open PR must merge before this work can start
- Identify if any open PR would conflict with likely approaches to this issue

### Step 3: Research Solutions

Launch these research sub-agents in parallel. Agents C and D inform the Case (they feed the Step 3.5 verdict, so they run before it). Agent G (Documentation Scoping) produces the Documentation Plan (Part II §11), which must reflect the **final** scope — so run it against the scope Step 3.5 settles: if the necessity/refinement verdict reduces or refines the scope (or you're unsure it will), defer Agent G to Step 4 (synthesis) or (re)run it there on the settled scope, rather than shipping a docs plan drawn for the original ask.

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

Launch an `Explore` sub-agent to map the documentation surface and propose where this change belongs. This is **not** a generic "update the docs" task — placement and content shape require the same rigor as code architecture.

The agent must read:
- `apps/docs/sidebars.ts` (reference sidebar — concept and API docs)
- `apps/docs/sidebarsGuides.ts` (guides sidebar — task-oriented walkthroughs)
- `apps/docs/docs/` directory tree (so it knows what pages already exist)
- `apps/docs/guides/` directory tree
- The relevant `packages/*/README.md` files for any package the change touches
- `CLAUDE.md` "Writing Style (site content)" section
- One or two existing pages closest in topic to the proposed change (to absorb voice and structure)

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

5. **For each page change (new or extended), draft a content outline.**
   The outline must include:
   - **Audience and prerequisites** — what does the reader already need to know? Link those concepts.
   - **One-paragraph lead** — what this is, in plain terms, in two or three sentences. No marketing.
   - **Section headers with one-line summaries** of what each section covers. Do not draft full prose at this stage — outlines only. The implementer will write prose.
   - **At least one minimal code example** — describe what it should demonstrate (the smallest possible thing that conveys the concept, not a kitchen-sink demo).
   - **Cross-links** — which other pages should link to this, and which should this link to? List both directions.
   - **Voice constraints** — explicitly cite the `CLAUDE.md` "Writing Style" rules that are most likely to be violated for this topic (e.g., "watch for em-dashes", "avoid 'powerful' adjective", "introduce term `capability` on first use").

6. **Return a structured docs plan** with one entry per affected file, in the format the spec template requires (Part II §11, Documentation Plan).

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
- A bug fix or correctness change — those don't go through this gate at all

**Signals to push back — toward *refine the substrate*, *build smaller*, or *don't build*:**

- The proposed change is mostly a `boolean | Config` toggle that resolves to one factory call
- The "feature" exists in a single vendor's API and has no analog elsewhere — and the framework would not be doing any translation
- A user could write the equivalent in 1–3 lines of existing escape-hatch code
- The cited precedent shares syntax but not semantics (the precedent normalized; this would not)
- The spec's edge-case table has entries that exist only because of where the API lives, not because of what it does
- "Defaults baked into the framework" is the main value delta over user-space wiring
- The spec includes a provider/platform guard error code

If two or more signals fire, that is a strong vote for pushing back — and the first move to weigh is whether refining an existing primitive dissolves the request (tenet 2), before either adding surface or forcing a workaround.

### Step 4: Synthesize and Draft Spec

Before drafting, check whether the research has surfaced a **design question that cannot be resolved from existing code alone**. Examples:

- Two plausible block / pattern / capability shapes that exercise different runtime behaviours
- A state model that "looks fine on paper" but you can't tell whether scope boundaries handle edge cases correctly
- A UI choice for devtool / kitchen-sink / renderer changes where the answer needs to be seen, not described

**Either way, consider a solution sketch** (`spec-template.md` §7). Where the solution's
shape is easier to see than to describe, sketching it makes you confront the design
concretely before asking anyone to sign off, shows the reviewer a shape instead of making
them reconstruct one, and gives the implementer a starting point. Include one when the
composition is novel or the ergonomics only show up in code; skip it when the change
extends an existing pattern.

**Write the sketch in the doc as pseudocode**, quick and dirty, not the end state. Name
roles (`the stream seam`) rather than functions you think exist: almost-real code invites a
reviewer to check the names against the repo, and then you are debating a seam nobody
proposed. Real code belongs on the spec branch as throwaway files, referenced from §7 —
the spec PR is never merged, so prototyping there is free and the doc carries no
API-shaped claims.

**Protect it in review, and expect to.** Automated reviewers will treat a sketch as code
and report missing error handling, loose types and edge cases. The reviewer contract at the
top of the spec PR says the sketch is out of scope at the line level (Step 6), and at
triage that feedback is a **Drop** — not even a §13 note, since there is nothing for the
implementer to weigh about code that isn't shipping. Only a comment on the sketch's
*direction* — wrong layer, wrong composition, won't work — is real, and that's an ordinary
fold. See [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Spec review".

**When a sketch isn't enough — build a POC, and pick the right kind.** A spec that hand-waves
through a question a day of throwaway code would have answered produces wasted implementation
work. Two routes, and the difference is **who reads the result**:

- **[`spec-poc`](../spec-poc/SKILL.md) — the published route, and the default here.** Built on
  the spec branch under `spec-poc/<ISSUE-ID>-<slug>/` so the reviewers and the human at the gate
  can run it. **Read that skill for the triggers and the four kinds** — the short version is an
  unverified premise, a novel composition, ergonomics that only show in code, something with a
  look, or two shapes in contention. The default is still *no POC*.
- **[`prototype`](../prototype/SKILL.md) — the private route.** You're exploring, undecided,
  and nobody else needs to see it: a throwaway flow in
  `apps/kitchen-sink/flows/_prototypes/`, answer captured in `NOTES.md`, brought back as
  input. Use it when the question is *yours* rather than the reviewer's.

**Create the spec branch before you commit a POC — and then Step 6 must not re-create it.** A
published POC has to be *on* the spec branch, so if a trigger fires, create the branch here,
once, from fresh `origin/main`: `git fetch origin main && git checkout -B spec/<ISSUE-ID>
origin/main`. Commit the POC to it. **Then tell Step 6 the branch already exists**, because
Step 6's `checkout -B spec/<ISSUE-ID> origin/main` *resets* the branch and would silently
discard every POC commit — leaving §7 and the PR description pointing at files that aren't in
the PR. A private `prototype` needs none of this: it isn't committed to the spec branch at all.

Either way, **record what it showed in §7 — including when the premise held.** A POC that
changed nothing is a real result; only reporting the ones that found problems teaches the next
reader that a quiet POC failed. A premise it settled goes in §12 with the same
"resolved, don't reopen" force a `settle-claim` verdict carries, and if it moved the design,
add a *Spec evolution* line. Building it costs **zero review rounds** and blocks nothing — but
if a load-bearing POC is still in flight when the gate is surfaced, **say so**, so nobody
approves on an unchecked premise. Full rules: [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Spec-branch POCs".

If the question is small enough to answer with a `fsdev block` invocation or a quick read, proceed without either.

Once design questions are resolved, draft the implementation spec. The spec must follow the project's conventions from `linear-practices.md`:

#### Spec Document Structure

The spec follows the **two-part template** in
[`docs/contributing/spec-template.md`](../../../docs/contributing/spec-template.md):
**Part I — The Case** (for the human decision-maker) and **Part II — The Build Plan**
(for the implementing agent), split by a hard divider. **Read the template — it is
the single source of truth for section order and what each section owes its reader.**
Every section there is one line of instruction followed by a **worked example** of that
section filled in, all from one running issue; write yours to match the example's shape
and altitude rather than reasoning from the instruction alone. Do not restate its
section list here; if the structure changes, it changes there.

**Title:** `{ISSUE-ID}: {Issue Title} — Implementation Spec`

How this workflow's research feeds the template:

- **Part I is the scan-first human surface.** It leads with the problem and why-now,
  the solution in plain terms *and the tenets it leans on* (cite `docs/philosophy.md`),
  the tradeoffs and the simpler alternative weighed, the **1–5 focus practices** tuned
  to this change (reasoned from the tenets plus the few established BPs — *not* a
  re-list of the global set), **1–5 usage examples** (from Agent D + your synthesis),
  and a numbered **Decisions & rules** block that is the human's sign-off surface,
  ending with the size estimate. Part I is also the spec-PR description and the Linear
  lead (Step 6).
- **Part II is the *directional* build plan** — technical design, implementation sequence (name the
  *removals* too, per tenet 3), edge cases, testing strategy (goal check + CI specs,
  informed by Agents A/E), documentation plan (from Agent G's Step 3G output),
  dependencies & open questions. Write it at the altitude the template defines (shape and
  sequence over finished design, diagram over signatures, depth pulled not pushed) — don't
  restate those rules here, follow them. **For a Large
  issue, the sequence includes a PR plan** — a small DAG of sub-PRs (`id · deliverables ·
  depends_on`) that `issue-lifecycle` builds in parallel where independent; record its
  shape as a Part I §6 decision (per the template).
- **When the change introduces or tightens an invariant** — a cap, a guard, a uniqueness
  rule, a graded property — Part II names its **convergence point** and every writer or
  producer that must pass through it, including legacy helpers and pattern-internal
  construction sites (tenet 5). An invariant enumerated at one entry point is the most
  expensive review class we have: the reviewer ends up finding the other writers for you.
- **The Step 3.5 verdict shapes Part I.** A "refine the substrate" or "build smaller"
  verdict changes what the Case argues for — reflect it in §1–§3, don't bury it.
- **Part I and Part II are drafted together, and Part I stays honest to Part II.** Write the Case
  from the research and the necessity verdict — it stands on its own — and the directional Build
  Plan alongside it. Verify every Decision and deliverable in Part I traces to a Part II section,
  and reconcile any that don't (either Part II is incomplete or Part I overpromised — fix it).
  Part I stays a *summary* of the plan, not an outline of it.

### Step 5: Validate the Spec

These validators check the technical design, sequence, PR plan, and docs plan — all Part II.

Launch two validation agents in parallel:

#### Agent E: Technical Validation
Launch a `feature-dev:code-architect` sub-agent to review the spec for:
- Consistency with existing architecture patterns
- Missing edge cases or error scenarios
- Whether the implementation sequence makes sense (dependencies, ordering)
- For a Large / multi-PR issue: whether the **PR plan** is a valid DAG (acyclic, every `depends_on` names a real sub-PR), the sub-PRs marked independent genuinely have no shared unmet dependency, and each is independently shippable/reviewable
- Whether the testing strategy is adequate
- Whether **Part I §5's** usage examples are present when the public API surface changes materially — showing the change *in use* (the actual calling code plus its observable result, with a before/after when a call site moves), not just the signatures — or, when they're skipped, whether the one-line justification is stated and defensible
- Any conflicts with the project's architectural constraints (check `docs/architecture/*.md`)

#### Agent F: Scope & Dependency Validation
Launch a `general-purpose` sub-agent to:
- Verify all referenced files actually exist in the codebase
- Confirm blocking issues are accurately represented
- Check if any open PR would create conflicts with the proposed approach
- Validate that non-goals are realistic (not punting critical work)
- Ensure the spec is self-contained enough for an isolated agent session

#### Agent H: Documentation Plan Validation
Launch an `Explore` sub-agent to review the Documentation Plan (Part II §11) specifically:
- Does the plan answer "is a docs change required?" with a real justification, or does it punt?
- For each proposed new page: does the proposed sidebar position actually make sense given sibling pages? Re-read the surrounding category and confirm.
- For each proposed extension: does the existing page actually exist, and is the proposed insertion point inside it sensible?
- Are there obvious affected pages the plan missed? (E.g., if streaming changes, was `apps/docs/docs/streaming/overview.md` considered?)
- Are new pages orphaned — i.e., does any existing page link to them per the cross-link audit?
- Does the content outline pass the project's voice rules, or are there flagged risks (em-dash overuse, marketing adjectives, undefined jargon on first use)?
- If the conclusion is "no docs changes," is that defensible, or is the agent skipping work?

Address any issues the validators surface. If there are unresolvable questions, add them to the "Open Questions" section.

### Step 6: Publish the spec — ready spec PR + Linear (kept in sync)

Publish the **full spec (Part I + Part II)** in two places that must hold identical content: a versioned doc in the repo (the reviewable artifact) and the Linear document (the issue-attached copy).

1. **Write `spec/<ISSUE-ID>.md`** (e.g. `spec/FIX-775.md`) with **Part I and Part II** in full, and an opening **Spec evolution** section with one entry: `- **Spec drafted** — <one line: how the problem is framed, the approach chosen, and the build shape>.` This is the canonical reviewable artifact.

2. **Open the spec PR ready for review.** Get onto `spec/<ISSUE-ID>` — and **which command depends on whether Step 4 already created it for a POC**, because the create form resets the branch:

   - **No POC (the common case): create it** on fresh `origin/main` — worktree-safe, so it's correct whether you're in the coordinator's checkout or a worktree spun off it (see [`orchestration.md`](../../../docs/contributing/orchestration.md) → Worktree branching): `git fetch origin main && git checkout -B spec/<ISSUE-ID> origin/main`.
   - **Step 4 built a POC: the branch already exists and carries commits. Do NOT run the line above** — `-B … origin/main` resets it, discarding every POC commit and leaving §7 and the POC block pointing at files that aren't in the PR. You are already on the branch in the same worktree, so just verify it (`git branch --show-current`) and commit onto it; if you somehow aren't, check it out **without** re-basing on main — `git checkout spec/<ISSUE-ID>` (or `git fetch origin spec/<ISSUE-ID> && git checkout -B spec/<ISSUE-ID> origin/spec/<ISSUE-ID>` if it was already pushed).

   Then commit the spec doc, push, and open a PR titled `spec(<ISSUE-ID>): <issue title>` **ready for review** (not a draft) with `create_pull_request`. **Label the PR `spec`** so spec PRs stay filterable and the orchestrators can find them by label (create the `spec` label in the repo if it doesn't exist yet).

   **The PR description opens with the two reviewer blocks, then Part I ("The Case") verbatim.** Both are required and they do different jobs — the **reviewer contract** (`## For reviewers — what this document is`, pasted verbatim from [`spec-template.md`](../../../docs/contributing/spec-template.md); it's the one lever we have on automated reviewers we can't instruct, so never ship a spec PR without it), then **"Parts worth reviewing closely"**, authored fresh for this spec. The rules for both, and the worked example, are canonical in [`pr-reviewer-guidance.md`](../../../docs/contributing/pr-reviewer-guidance.md) and [`spec-template.md`](../../../docs/contributing/spec-template.md) → "Parts worth reviewing closely" — follow them there rather than re-deriving them here. **If a Step 4 POC was built, add the POC block too** (one runnable command per artifact, the question it answers, and that it's throwaway).

   Part I follows — problem/why-now, solution in plain terms and the tenets it leans on, tradeoffs, focus practices, usage examples, and the numbered Decisions & rules — so reviewers see the scan-first shape without opening the doc; Part II (the directional Build Plan) is reviewed via the committed doc diff, not pasted into the body. It is docs-only (no changeset — BP-022) and is separate from the eventual implementation PR. Its purpose is to get the project's automated reviewers to critique the design *before* any code is written. Because this PR is never merged (it's closed unmerged when implementation starts), it is also the place to show **fuller worked examples** that would bloat the spec — as PR-description sections or committed throwaway example files. Keep the spec doc's own examples small (Part I §5); put anything larger here, so the implementing agent isn't forced to wade through it.

3. **Publish to Linear.** Check for an existing spec document on the issue: `update_document` if one exists, else `create_document` linked to the issue — with the same content as the repo doc (the full spec).

4. **Update issue relations and comment**:
   - Add/update dependency relations discovered during research (`save_issue` with `blockedBy` / `blocks`).
   - Add a comment summarizing: "Implementation spec created/updated. Open questions: [list if any]." Include the **Decisions & rules** block from Part I §6 verbatim, and a link to the **spec PR**. The durable record lives on the issue so a reviewer can evaluate the direction without opening the full spec.
   - If open questions exist, flag the issue for discussion.

5. **Mirror every change to Linear.** `spec/<ISSUE-ID>.md` is the review surface and dies with the PR; the Linear document is what survives. Any later edit — most often from spec-PR review (Step 6.5) — is mirrored to Linear in the same change set, so the durable copy is never the stale one.

6. **Move the issue to "In Spec Review"** with `save_issue`, *after* the repo doc, PR, Linear document, and publishing comment are all in place. If the team has no "In Spec Review" state, fall back to the closest equivalent and note it in the comment.

### Step 6.5: Respond to spec-PR review

The spec PR draws automated review from the **same bots that review code PRs** — reviewers we don't control and can't instruct. They're tuned for code, so they reliably return exhaustive, line-level, code-shaped feedback on a document that is deliberately not a finished design. That's expected behavior, not a problem to argue with. **The discipline is ours: triage against the bar, don't negotiate.**

Read [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Spec review: the bar and the convergence rule" first; it is canonical for the bar, the dispositions, and the budget. This step is how you execute it.

**First, get onto the existing spec branch.** Each review round runs in a *fresh* worktree, so don't assume you're still on `spec/<ISSUE-ID>` from Step 6 — check it out from origin (do **not** re-base it on `main`; that would discard the spec commit): `git fetch origin spec/<ISSUE-ID> && git checkout -B spec/<ISSUE-ID> origin/spec/<ISSUE-ID>`.

#### 6.5.1 Triage every comment — one disposition each

For each piece of feedback ask the only question that matters at this altitude: **does acting on this change the approach?** Then pick exactly one:

- **Fold in (spec-level).** The approach is wrong or won't work · it solves the wrong problem · a Part I Decision is wrong or missing · a constraint the design didn't account for invalidates it · scope is wrong (a deliverable that shouldn't ship, or a missing one) · the spec contradicts itself. Re-draft the affected sections per 6.5.2, keep repo doc ↔ Linear in sync, reply on the thread.
- **Note for the implementer (the default).** Everything below that line: naming, file layout, local structure, which helper, error-message wording, a micro-optimization, a test-name preference, "have you considered X *here*", or a detail Part II left open on purpose. Record it **verbatim** in the spec's **§13 Review notes for the implementer**, and reply once saying it's recorded for implementation rather than baked into the design. **Do not rewrite the design prose around it** — that pretends the spec can settle something it can't, and it's what turns a sound spec into a churning one.
- **Drop.** Already answered in the spec · out of the issue's scope · a preference with no defect behind it · a factual error about the codebase. Reply once with the pointer or the correction. No spec edit, no §13 note.
- **Settle (empirical dispute — only once a loop has formed).** A **factual claim about how the system behaves** — "a router can't do that", "the store won't preserve ordering there", "that capability doesn't compose with a sequencer's state" — that has now been **asserted and counter-asserted at least twice**, where the spec's approach *depends* on it and running code can decide it. You can't fold it (you'd be guessing which side is right) and you can't note it (the approach rests on it), so **settle it with a POC** — see 6.5.3. **Requesting a settlement costs zero review rounds**, and the spec keeps converging while it runs.

**Settle on the loop, not on the assertion.** A claim asserted *once* — however confidently, however wrong it sounds — is ordinary triage: answer it, fold it, or drop it with a pointer to the code. The trigger is the **second** pass: the claim came back after being answered, or the spec has already flipped on it, or two rounds reached opposite conclusions. That repetition is the signal prose has failed on it, and it's the one case where another round of argument is predictably wasted. Fire then, and not before — POC-ing every assertion would replace a two-round review with a queue of experiments, which costs more than the debate did.

**The default is Note, and the burden of proof is on folding.** If you can't name which Part I Decision or which part of the approach changes, it isn't spec-level. The one cheap exception: genuine factual corrections and broken references get fixed inline without ceremony — they don't move the design, so they don't cost a round.

Two instincts to override, because both run the wrong way:

- **A note is not a deferral.** §13 is *how* a good observation gets acted on — at the altitude where it can be judged against real code. The implementer reads it as input.
- **Volume is not signal.** Ten below-the-bar comments don't add up to one spec-level problem. Ten notes is a normal review of a directional document. A reviewer restating a below-the-bar point hasn't promoted it — reply once; the repeat needs no new answer.

**Escalate genuinely debatable feedback to the user.** When a suggestion is *spec-level* and both the reviewer's and the spec's positions are defensible — a scope change, a reversed decision — don't silently accept it: surface it with the trade-off (`AskUserQuestion` for a crisp choice) and let the user decide. This is for direction forks only; a below-the-bar comment is never worth a user prompt.

#### 6.5.2 On a spec-level pivot, re-draft — do not append (anti-addenda rule)

When review changes the *direction* (a different approach, a dropped/added deliverable, a reversed decision), rewrite the affected Part I and Part II sections so the spec reads as one coherent document. Do **not** bolt a "reconciliation / AUTHORITATIVE" section onto the top that contradicts the body — an incoherent spec produces an incoherent implementation (tenet 1). Small clarifications can be inline; a changed direction gets rewritten. Keep the repo doc and Linear document in sync through the rewrite. **Then record the pivot as one line in the spec's Spec evolution timeline** (`- **After spec review** — <what changed>, because <why>.`) — the body stays coherent, the timeline carries the why so the debate isn't lost. A §13 note never earns a timeline entry; it changed nothing.

#### 6.5.3 Settle an empirical dispute with a POC (non-blocking)

When triage lands on **Settle**, the debate stops and a throwaway POC decides it.
**[`orchestration.md`](../../../docs/contributing/orchestration.md) → "Settling a disputed claim
(POC settlement)" is canonical** — when it fires, the claim-slice shape, what it costs, the
three outcomes. Read it. Four things are this step's:

1. **Try the two cheap outs first.** *The answer is in the repo* — the code, its tests,
   `docs/architecture/*`, an existing `goals/*/*/goal.md` — so reply with the citation (a
   **Drop** with a pointer) and dispatch nothing. Or *the claim is already settled on this
   spec* — §12 carries it with evidence — so reply once pointing there and **charge zero
   rounds**. A settled claim is closed; re-litigating it, by a bot or a human or from a novel
   angle, does not reopen it.
2. **Write the claim slice** (`claim` · `load` · `falsify` · `threads` — the shape in
   `orchestration.md`). If you can't fill `falsify`, this isn't empirical: route it as a
   direction fork instead.

   **Then record the claim in §12 marked `(POC in flight)`, in this same pass, and push it.**
   This is not bookkeeping — it is the **only** durable carrier of the settlement. You exit at
   the end of this step and the status line you return dies with the dispatch that read it, so
   the spec doc is what tells everything downstream a settlement is live: `issue-implement`
   reads it to leave the spec PR open (and to not treat the claim as a blocking open question),
   and the next reviewer reads it to see an answer is coming. Skip it and the deferral silently
   doesn't happen — the PR closes, and a `REFUTED` verdict lands on a deleted branch.
3. **Dispatch or request, depending on whether you'll outlive the answer.** Standalone, you
   own your session: dispatch the **`poc-agent`** yourself and keep triaging while it runs —
   collect the verdict *if it returns before you close the round*, and otherwise disclose it
   as in-flight and close the round anyway. As a **bounded worker** under a lifecycle you exit
   at the end of this step, so the verdict would have nowhere to land: return the slice as
   `settle_requested` and let the coordinator dispatch it. **Either way you never hold the
   round open waiting** — the POC gates nothing.
4. **Route the verdict into the spec** (the part `orchestration.md` leaves to the artifact):

   - **CONFIRMED** → reply on the thread; record it in **§12** as resolved-with-evidence. No
     spec rewrite, and **no** *Spec evolution* entry — nothing changed, same rule as a §13 note.
   - **REFUTED** → re-draft the affected sections per 6.5.2 (repo doc ↔ Linear in sync), reply,
     record in §12, and add one *Spec evolution* line: `- **After POC settlement** — <what
     changed>, because the run showed <what>.` Costs **one round outside the budget**; say so
     in one line.
   - **INCONCLUSIVE** → don't retry and don't pick a side. Surface it to the user as a
     direction fork with the trade-off (`AskUserQuestion`).

#### 6.5.4 Converge — two rounds, then hand to the human

**Default budget: two rounds** (a *round* = one pass over the feedback outstanding since the last push). After round two the spec has converged: say so, and present it for the approval gate with any remaining open threads carried as §13 notes. Spend a third round **only** when round two surfaced a genuine spec-level finding — a new approach question, not more notes — and state that in one line so the extra round is a visible decision rather than drift.

What makes stopping safe:

- **An unresolved thread on a spec PR blocks nothing.** This PR is never merged, so it has no merge gate and open threads have no gating power. **Do not drive threads to zero** — that habit is correct on code PRs and does not transfer here.
- **Nothing is lost.** Below-the-bar feedback is in §13 and reaches the implementer; above-the-bar feedback was folded in. There's no third category needing rescue.
- **Implementation reviews the design again, better.** The challenger re-tests it against real code, the diff gets the full `review` panel, and a spec blind spot found there is folded back and flagged loudly. The spec isn't the last line of defence.
- **The one thing a note can't rescue is handled separately.** A contested *factual* claim the approach rests on isn't fixed by carrying it forward — it needs an answer, not a reader. That's what **Settle** (6.5.3) is for, and it's why converging is still safe with one in flight: the POC runs concurrently, the verdict lands on the PR, and a REFUTED verdict buys its own round outside the budget.

A bot leaving `CHANGES_REQUESTED` on a spec PR does **not** hold the gate (only a human's approval trips it — see Gates) and does **not** extend the budget. Never re-review to satisfy a bot, and never re-request review from one.

#### 6.5.5 Sign-off

The spec PR is done when it's converged and the user has signed off on the **direction**. **The sign-off signal the orchestrators gate on is an approving comment or GitHub Review from the user on the spec PR** — either a comment saying "approved" or a Review with `state: APPROVED`, authored by a human (not a bot, not a bot-authored comment/review, and for a review, not the PR's own author); see `docs/contributing/orchestration.md` → Gates. A comment or a review is the gate because either *wakes* the orchestrator, where an applied label doesn't. **On sign-off, apply the `spec approved` label as the durable mirror** if it isn't already present — the label records the gate (and keeps spec PRs filterable); it no longer triggers it. The approval is what authorizes closing the spec PR and starting implementation: from the agreed spec, implementation proceeds and the spec PR is closed unmerged — under `issue-lifecycle` the lifecycle closes it at the approval gate, standalone `issue-implement` closes it during branch setup. Don't merge or close the spec PR yourself.

### Step 7: Reframe the Issue Description

This step is required, not optional. The spec now exists as the authoritative source of *how* — so the issue must be reshaped to be the authoritative source of *what* and *why*. Even issues that already look "fine" usually need pruning: details that were appropriate before the spec existed are now duplication.

**7.1. Diff the existing issue description against the spec.** Read the current description carefully and classify every section/bullet as one of:

- **Keep in issue** — problem statement, motivation, user/business value, desired outcomes, high-level scope boundaries, success criteria expressed as observable outcomes (not implementation), stakeholders, links to related issues/projects.
- **Move to spec** — file paths, function/API signatures, architectural decisions, sequencing, test strategy, error taxonomies, schemas. If any of this is in the issue and *also* in the spec, delete it from the issue. If it's in the issue but *not* in the spec, first verify whether the spec's approach actually covers it; if so, delete from issue; if not, that's a gap in the spec — go fix the spec.
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
- Long checklists of work items (the spec's Implementation Sequence covers this; the issue's acceptance criteria should be outcome-shaped, not task-shaped)

**Note for borderline issues.** Not every issue warrants a separate spec document. If the work is small enough that the full issue-spec workflow would be overkill but still requires agent-ready clarity, the **agent-brief template** at `docs/contributing/agent-brief-template.md` is the right shape for the issue body itself. In that case you're not running issue-spec at all — the brief IS the contract. Use issue-spec when the implementation needs research, multiple sub-agents, or a documentation plan; use the agent-brief template directly when the issue fits on one screen and the contract is local.

**7.4. What's legitimately allowed to stay even though it's specific:**

- Concrete success criteria that happen to mention public API surface a user will see (e.g., "users can call `defineCapability({...})` to declare a reusable capability") — this is *what users get*, not *how it's built*.
- A short "Documentation Deliverables" line if the project requires it for user-visible features. Keep it short — the spec's Documentation Plan has the detail.
- Performance, latency, or compatibility targets — these are outcomes.

**7.5. Apply the update** with `save_issue`, replacing the description. If the existing description had content worth preserving for archival reasons (e.g., a historical decision thread), put that in a comment rather than the live description so the description stays clean.

**7.6. Note the reshape in the publishing comment** added in Step 6.4 — extend it with: "Issue description reframed: [one-sentence summary of what was moved out / what now leads]." This gives reviewers a heads-up that the issue text changed shape, not just content.

### Step 8: Present Summary

The full spec (Part I + Part II) is published as a ready spec PR. Present it to the user and tell them the next move: **review the spec PR for direction, then approve it** (an approving comment or GitHub Review is the single sign-off gate that releases implementation). Say plainly what they're signing off — the problem framing, the approach, and the numbered Decisions — and that line-level detail is the implementer's, so they needn't read for it. Present:

1. **Necessity & refinement verdict** (one line): "Build as scoped", "Refine the substrate — <primitive> covers it", or "Build smaller — dropped <X>." Surfacing this in the summary lets the user see that Step 3.5 actually ran and what its outcome was; future readers can audit whether the gate worked. If the verdict was anything other than "Build as scoped," you will not have reached Step 8 without user confirmation — note that confirmation here too.
2. **Part I ("The Case")**: paste it verbatim, **leading with the plain-language problem and solution** (BP-039) so the user gets the gist before any dense detail, and keeping the tradeoffs, focus practices, usage examples, and numbered decisions so the user can evaluate the change at a glance. This is the same scan-first surface the spec PR description leads with (Step 6, item 2) — the user should see exactly what they'd see opening the spec document. If you find yourself rewording it for the summary, Part I itself is wrong; fix it in the spec and then paste here.
3. **Approach chosen**: 2-3 sentences on what the spec proposes and why
4. **Decisions & rules**: paste the spec's Part I §6 **Decisions & rules** list verbatim — each decision, the alternative rejected, and what it locks in. This is what the user reviews to sign off on the direction, not just the code. If you can't name five that genuinely shape the outcome, say which ones are load-bearing and why the rest are mechanical.
5. **Documentation plan**: one or two sentences naming the docs surfaces affected, any new pages and their sidebar placement, and explicit call-out if the conclusion is "no docs changes." Never omit this — the user has flagged docs scoping as a recurring miss.
6. **Issue reshape summary**: one or two sentences on how the Linear issue description was reframed — what implementation detail was moved out, what now leads, and whether anything was found stale/contradicted. If the issue needed no reshape because it was already PM/business-shaped, say so explicitly.
7. **Dependencies identified**: what must land before this can start
8. **Open questions**: anything that needs the user's input before implementation (including any open docs-placement questions)
9. **Links**: the Linear issue, the spec document, and the spec PR

If there are open questions, ask the user to resolve them. Once resolved, update the spec document with the decisions.

## Guidelines

- **Depth over speed *in authoring*; convergence over exhaustiveness *in review*.** Authoring is a research task — spend the time, because a thin spec is worse than no spec (it gives false confidence). Review is the opposite discipline: the spec is already researched, and the job is to confirm the direction and stop. Depth up front is what *earns* a short review.
- **Be directional, and don't apologize for it.** Part II fixes the shape and sequence, not the finished design. A reviewer pointing at an unsettled line-level detail has found something the spec left open **on purpose** — that's a §13 note, not a gap to close.
- **Be specific about direction, not signatures.** "Update the server" is not a spec. "Resume an SSE stream by filtering out items below the caller's last-seen sequence number, at the streaming seam" is — it names the actual behavior and where it lives without pinning the exact signature or file path (those are the implementer's).
- **Show the code in use, not just the contract.** When the change materially alters the public API surface, **Part I §5** must include minimal usage examples — the actual code a developer or end user writes against the new or changed surface and the observable result — not only the signatures. Part II §7 names the API surface directionally; §5's examples show someone calling it. Skip only when nothing about how code is written against the framework changes (internal refactor, pure type/schema change, config or build plumbing, a bug fix that restores documented behavior), and say so in one line.
- **Follow existing patterns.** The codebase has established conventions. The spec should extend them, not invent new ones. When deviating, explain why.
- **Research is not copying.** Industry research informs the approach but the implementation must fit this codebase's architecture, not blindly adopt an external pattern.
- **Self-contained.** The spec must include everything an implementer needs. If they have to read 5 other documents to understand the spec, it's not done.
- **Non-goals matter.** Explicitly stating what you're NOT doing prevents scope creep and sets expectations.
- **Documentation is part of the spec, not an afterthought.** Every spec must include the Documentation Plan (Part II §11) with a real answer — including "no docs changes required" with justification. Never leave it as a vague bullet like "update the README." Sidebar placement, content outline, and cross-links must be decided at spec time, because that's when the agent has the context to decide well; deferring to implementation time guarantees a worse decision.
- **Reframing the issue is part of the spec workflow, not a post-script.** Step 7 is required. The moment the spec is published, any solution detail still living in the issue is duplicate or stale. Removing it preserves the issue/spec separation and prevents future readers from following the wrong source. Do not skip it because the issue "looks fine" — re-read it through the PM/business lens and prune.
- **Open questions are OK.** It's better to flag uncertainty than to make a wrong assumption. Present options with trade-offs and let the project owner decide.
- **Dependency accuracy is critical.** If you say "no dependencies," an agent will start building immediately. If there's actually a dependency, the work gets thrown away. Be thorough.
- **Push back when you should.** Your job is not to produce a spec on every issue; it is to produce specs for the issues that warrant them. When Step 3.5 surfaces a wrapper-over-primitive shape, single-vendor leakage into framework surface, or a precedent-mirror that doesn't transfer semantically, the right deliverable is a concise case for *not* shipping and one or more proposed alternatives. The user can override — but you have to actually present the case. A spec the user later cancels is more expensive than five minutes of "should we even build this?"
