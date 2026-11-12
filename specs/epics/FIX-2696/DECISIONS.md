# FIX-2696 · Decisions

[Spec](SPEC.md) · **Decisions**

## The tree

```mermaid
flowchart TD
  D1["D1 · Five sections, told from the app down"] --> D2["D2 · Written for the kits release, one cutover"]
  D2 --> D3["D3 · Pages wait in docs/contributing until cutover"]
  D1 --> D4["D4 · A smaller model writes; the loop checks"]
  D1 --> D5["D5 · Reference is generated"]
  D1 --> O1["O1 · Open · what we promise about sharing kits"]
  D2 --> O2["O2 · Open · lead with starters"]
  D5 --> O3["O3 · Open · how much is deleted"]
```

## D1 · Five sections, told from the app down

Start, Concepts, Catalog, Build and Reference replace today's eleven sidebar groups. The story runs starter, kit, flow, block. "Advanced" goes away as a category; its twenty pages regroup by the reader's job.

**Why.** The audit found the landing page and the docs describe different products, and that the reading path has no end. *If wrong:* a restructure is redirects and a sidebar file; the pages survive.

## D2 · Pages are written for the release that carries kits, and ship in one cutover · decided by the owner, 2026-11-11

Pages describe Workforce, the harnesses and Claude Code as kits an app installs. Nothing publishes before that release.

*If wrong:* if kits slip, the kit snippets and the Catalog wait; Concepts and Reference can still ship.

## D3 · Pages live in `docs/contributing/docs-revamp/pages/` until cutover

The repo's rule is that user docs change only at release, and CI enforces it. Writing in the contributor folder keeps every PR mergeable and keeps unreleased surface off the site. FIX-2705 moves the pages under `apps/docs/` in one release-docs pass.

## D4 · A smaller model writes each page; two checkers review it; the writer revises · tried on Blocks, 2026-11-12

The loop is: write from the brief, fact-check against the code with a type-check of the examples, prose-check, revise. On the Blocks page the first draft needed the review round, mostly for scope and density, and the revision stood beside the pilots. A person reads each Concepts page cold before it merges.

## D5 · The API reference is generated from doc comments

The seven hand-written `api/*` pages and the long READMEs go. Behaviour that is a state machine or a contract is hand-written as tables (FIX-2699). The choice of generator is FIX-2698's.

## O1 · Open · How much the docs promise about sharing kits

The owner's direction is a community that builds, shares and remixes kits. `docs/objectives.md` lists "a third-party plugin or extension ecosystem: publishing, discovery, versioning, a registry" as a non-goal, and FIX-2618 chose the word "kit" to avoid promising one.

**Recommendation.** Teach sharing as something that works the day kits ship: a kit is an npm package anyone can publish, and "Write a kit" is a tutorial. Give the Catalog a "From the community" shelf that starts empty. Say nothing about a registry. Update the objectives file to match.
**Changes my mind:** a registry or discovery feature with a date.
**If wrong:** over-promising costs trust with the first readers; under-promising costs one landing page later.
**Touches:** FIX-2702, FIX-2703.

## O2 · Open · Whether the docs lead with starters before a starter installs in one command

Today a starter runs from a clone of the framework monorepo, and building on one means forking the framework.

**Recommendation.** Lead with starters, and treat a one-command install as a requirement before the Start pages publish. The examples folder already has a copy-out recipe. Until then the page uses the clone path and says so.
**Changes my mind:** the install is more than a quarter away. Then Start opens on the terminal run of one flow.
**If wrong:** a first-run page that takes thirty minutes loses the readers the epic is for.
**Touches:** FIX-2702, and product work outside this epic.

## O3 · Open · How much detail is deleted

About 330,000 words leave the reading path. Much is regenerated as reference. Some is deleted: migration notes for past releases, internal mechanisms, narrated race conditions, pages about the framework's own test suites.

**Recommendation.** Keep behaviour a user can observe and depend on, as tables. Delete history older than the current release, and delete mechanism. About a third of today's words go for good.
**Changes my mind:** evidence that users rely on a specific deep page.
**If wrong:** someone hits an undocumented edge and reads the source. Git history keeps every page.
**Touches:** FIX-2699, FIX-2705.

## Who owns what

| Area | Owner |
|---|---|
| Page types, budgets, the concept outline, code-example rules | FIX-2697 (today: `WRITING-BRIEF.md`) |
| Generated reference, READMEs | FIX-2698 |
| Tabular behaviour reference, Upgrading | FIX-2699 |
| Machine-readable output | FIX-2700 |
| Concepts pages | FIX-2701 |
| Start pages | FIX-2702 |
| Catalog pages, the kit-page template | FIX-2703 |
| Tutorials and recipes | FIX-2704 |
| Navigation, redirects, removing old pages, reconciling kit claims | FIX-2705 |

**Rules every child obeys**

- **ER-1 · A fact has one home.** Every other page links to it.
- **ER-2 · Nothing lands under `apps/docs/{docs,guides,blog}` before FIX-2705.** (D3)
- **ER-3 · Every page passes `scripts/check-docs-page.mjs` and `scripts/check-retired-terms.mjs`.**
- **ER-4 · Every code example names its file and imports or declares every name it uses, in the one example-app layout the brief defines.** No phantom names.
- **ER-5 · A page says what the thing is before it says why it exists.** "What it gets you" comes after the explanation.
- **ER-6 · Where our word differs from the industry's, the page says so once**, in an "If you know ..." section: what is the same first, then the one difference.
- **ER-7 · No option tables, error cases or migration notes outside Reference.**
- **ER-8 · Kit names, config keys and import paths in a page are reconciled against the shipped surface at FIX-2705**, not before.

## Coordination seams

- **FIX-2618 and FIX-2627.** Workforce and the harnesses become kits there. FIX-2703 waits on FIX-2627 for the real install lines.
- **The release-docs process.** FIX-2705 is one release-docs pass, larger than usual. The pending changesets' docs lines are folded into the new pages, not the old ones.
- **`docs/contributing/glossary.mjs`.** "Worker" means the named agent a user talks to; "person" and "member" are retired where a user or worker is meant. A page that coins or retires a public term edits the glossary in the same PR.
- **Starter install.** Product work O2 depends on; not in this set.
- **The Claude Code-style starter's name.** Needed before its Catalog page.

## Decided while drafting, recorded so no child reopens them

- The first page opens "Most agent frameworks hand you parts. Flow State hands you an app." The prose reviewer flagged it as a slogan; kept.
- The remix line stays on the first page: "That is how one developer's app becomes the base for another's."
- Workers are introduced as agents, and the page then says what differs: a worker runs on a flow, and the flow is yours to define.
- A concept page shows four code blocks at most and does not reprint a file to change one line.
- The product is written "Flow State".
- Shift Manager is documented as a starter; the Shift Coordinator page moves with it.

## How it got here

Four readers audited all 193 pages on 2026-11-11 for duplication, concept-versus-reference mix, voice and the first-hour path. The full findings, the proposed structure, the fate of every section and a verdict for every page are retained in [`analysis/RECOMMENDATION.md`](analysis/RECOMMENDATION.md). Three pilot pages set the voice. A fourth page, Blocks, was then written by a smaller model from the brief alone to test whether the brief was enough; what it exposed went back into the brief.

Not done for this spec: the `analysis` pass and the end-state POC that an epic spec normally carries. The pilots and the Blocks run stand in for the POC.
