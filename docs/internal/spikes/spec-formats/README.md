# Spike · four shapes for the spec, plan, PR body, and explainer

**The problem.** Reading a spec or a PR description costs a book. FIX-1362's spec is 4,536 words of prose and its PR body about 1,150 more. The explainer beside them is the only part anyone reads in one sitting. The content is right. The shape charges the reader for the author's effort.

**This spike** rewrites two real specs four times each. Each rewrite is a **set**: PR body · spec · plan · explainer, with the spec/plan split applied throughout. Same facts, same decisions, same open calls. Each set makes one bet about what carries the meaning.

| Reference | What it exercises | Why it's here |
|---|---|---|
| [`FIX-1362/`](FIX-1362/) · [PR #1766](https://github.com/fixpoint-labs/flow-state-dev/pull/1766) | A code feature: 3 packages, public API surface, 9 steps, tests, a goal check, a two-PR seam, an invariant to protect, 13 edge cases | **The primary reference.** The parts of a spec that are hardest to make short |
| [`FIX-1366/`](FIX-1366/) · [PR #1765](https://github.com/fixpoint-labs/flow-state-dev/pull/1765) | A docs-only issue: no code, no tests, no architecture | The control. Built first; kept because it shows the floor each shape reaches when there's nothing technical to carry |

| Folder | The bet | Spec carries | Plan carries | Explainer |
|---|---|---|---|---|
| `a-form/` | A spec is a **form**. Fixed fields, each a line or a table | Problem table · one before/after diagram · surfaces table · R table · D table · evolution table | Steps table with a test column · traps · the fence · refresh rules · edge cases · docs | Folded |
| `b-diagram-first/` | The explainer's format **is** the spec's. A diagram per section, ≤ 40 words under each | Today · after · mechanism · activation · decision tree · boundary · evolution | Step DAG · drawn names, fence, refresh · traps · edge cases | Merged |
| `c-traceability/` | The reader wants **R → D → S → V to line up**. IDs everywhere | Context · goal · R table with *met by* · D cards (instead of / because / locks in / serves) · news · out-of-scope with owners | Surfaces S1–S10 · checks V1–VG · sequence matrix · guardrails · edge cases | **Kept, unchanged, as the control** |
| `d-journey/` | Change is understood as **what a person sees before and after**, and the repo as a diff | People table · worker file as a `diff` · one mechanism diagram · *Why not…* Q&A · what stays · sign-off lines | Per-seam before / after / proof cards · order · edge cases · docs | Folded |

Read each folder in the order a reader meets them: `PR.md` → `SPEC.md` → `PLAN.md`.

**A fifth folder, [`FIX-1362/e-svg-poc/`](FIX-1362/e-svg-poc/), is not a shape.** It's a POC of hand-authored SVG for the five concepts in FIX-1362 that every mermaid rewrite flattened: containment, a boundary, a grid over time, height as cost, and layering. Each figure sits beside its mermaid attempt so the loss is visible.

## Measured

Prose words, fenced blocks excluded. B's diagrams and D's diff blocks are **not** counted, so both read longer than the number.

**FIX-1362 · the code spec**

| | Spec | Plan | Spec + plan | PR body | Explainer | Diagrams (set) |
|---|---|---|---|---|---|---|
| **Today** (PR #1766) | 4,536 (Parts I + II) | — | 4,536 | ≈1,150 | 132 | 6 |
| **A · form** | 1,038 | 1,241 | 2,279 · **50%** | 591 † | 0 | 2 |
| **B · diagram-first** | 448 | 605 | 1,053 · **23%** | 224 | 0 | 13 |
| **C · traceability** | 914 | 1,025 | 1,939 · **43%** | 394 | 170 | 3 |
| **D · journey** | 809 | 999 | 1,808 · **40%** | 357 | 0 | 1 |

† A's PR body carries two collapsed blocks (engineering calls, the review-round fold). Above the fold it is ≈300.

**FIX-1366 · the docs-only control**

| | Spec | Plan | Spec + plan | PR body | Explainer | Diagrams (set) |
|---|---|---|---|---|---|---|
| **Today** (PR #1765) | 5,545 | — | 5,545 | ≈1,100 | 153 | 4 |
| **A · form** | 815 | 803 | 1,618 · **29%** | 391 | 0 | 2 |
| **B · diagram-first** | 364 | 366 | 730 · **13%** | 205 | 0 | 13 |
| **C · traceability** | 801 | 772 | 1,573 · **28%** | 333 | 194 | 3 |
| **D · journey** | 653 | 626 | 1,279 · **23%** | 278 | 0 | 0 |

**The number that matters is the gap between the two tables.** On a docs issue every shape lands at 13–29% of the original. On a code feature the same shapes land at 23–50%. The difference is the plan: the implementer's contract on a code change (traps, an invariant, refresh rules, edge cases, per-step proof) does not compress the way the case does. A 1,000-word plan is four minutes of tables, which is a form, not a book. But it is not a fifth.

## What each one is good at, and what it drops

| | Best at | Drops or strains |
|---|---|---|
| **A** | Scannable one screen per section. Nothing to interpret. Easiest to template | Decisions in a table lose the *because*. On the code spec the R table hit 11 rows and the plan hit 1,241 words: tables scale linearly with the material and never fold |
| **B** | The shortest by a wide margin on both references. The step DAG, the drawn fence, the refresh flowchart and the decision tree are the best single artifacts in the spike | Some diagrams are lists in boxes (the boundary panel, the evolution panel). A reviewer can't diff a diagram in a thread. Reasoning survives only as edge labels and one-line captions |
| **C** | The implementer's and the bot's favourite: every requirement names its decision, surface, and check. The D cards are the best decision format here | IDs are the "bare number" failure the guidance warns about. `R6 · S7 · V7` is a puzzle to a cold reader. Second-longest on the code spec |
| **D** | The most human. The people table and the *Why not…* Q&A carry the design thinking in plain language. The `diff` block shows a file-shaped change exactly | No IDs, so a bot can't cite a row. On the code spec the plan's per-seam cards went to 999 words: prose cells don't compress like table cells. A `diff` of internals would be the pseudo-code the template warns against |

## What the code spec taught that the docs spec couldn't

- **The plan is where the length lives.** Three of four plans on FIX-1362 are over 1,000 words. Only B's, at 605 plus four diagrams, is under 700, and it got there by *drawing* the fence, the refresh rule, and the pinned names instead of tabling them.
- **The explainer earned more on the code spec.** In C, where it was kept, its panel 3 draws the activation tiers, which C's own spec doesn't draw. B draws them in its spec and D draws them nowhere. So "retire the explainer" holds only where the spec itself carries a mechanism diagram, not just a before/after.
- **Proof rows should state behaviour, not location.** Every set says the unheld-skill refusal happens "at the mint". The real implementation (#1776) found it could not: a rule spanning two settings can't sit on a closed config schema, so it fires on the seat's first turn, and the implementer had to write a paragraph explaining the deviation. None of the four formats made room for that. A plan's proof row should say *fatal, by name, before the seat answers*; where it fires is the implementer's.

## What all four give up, on purpose

- **The evidence behind an instruction.** The original spends paragraphs proving a claim (the resolver alternative, the FIX-918 reseed, why four pages must not be "fixed"). All four keep the instruction and one clause of why. Tenet 6 says a doc that drops its reasoning is worse, not shorter. These drop the *derivation*, not the reason. Whether one clause survives a bot review is the thing to watch on the first real round.
- **One Linear mirror becomes two.** BP-037 mirrors the spec to a Linear document. A split means the plan is mirrored too, or lives only on the PR.

## Recommendation

**Spec from D, decisions from C, plan from B, PR body from D. Retire the explainer at issue altitude, on one condition.**

- **Spec = D's structure + C's cards + two of B's diagrams.** The people table is the fastest way found to say what changes for whom. The `diff` block is right for a file-shaped surface (a worker file, a docs page, a config) and should be *forbidden* for internals. Swap D's sign-off lines for C's cards: *because* and *locks in* are the two lines that keep tenet 6 honest. Add B's mechanism diagram and its decision tree, so the spec draws what the explainer used to. Budget: ≤ 800 prose words, ≤ 3 diagrams.
- **Plan = B.** A step DAG with a proof table beside it, and every invariant drawn rather than tabled. Keep reference material (edge cases, pinned names, docs surfaces) as tables. Proof rows state observable behaviour, never the seam it fires at. Budget: ≤ 800 prose words plus diagrams. On a code feature expect to hit it, not beat it.
- **PR body = D's people table, then a 3-row sign-off table, then look-here bullets, then links.** ≤ 300 words above the fold, one diagram at most. This breaks `pr-reviewer-guidance.md`'s *never a table* rule for ratified decisions on purpose; keep the six-part prose shape for a **live fork**.
- **Explainer: retire at issue altitude once the spec carries the mechanism diagram.** Without it, C shows the explainer still adds one panel the spec lacks. Keep it at **epic** altitude, where *the set* and *the path* have no other home.

**What would change my mind.** A real review round. If bots on a table-shaped decision list produce more off-altitude findings than today, the *because* line isn't enough and the cards need a sentence more. If the plan's 800-word budget forces the implementer to re-derive a trap the original spelled out, the plan needs a collapsed *why* per trap, which the fold allows.

**Cost of being wrong: low.** These are templates. A bad pick costs one issue's spec written twice.

## Round 2 · the mixed set

Feedback on round 1, in one line each: the SVG POC is the clearest thing here and belongs in the docs, with a short description under each and a mermaid companion where it helps. The journey spec and PR body work. The explainer's real job is the decision record. The form is out, but a rules document that lays the logic cases out for a human is in. The plan is for the LLM, so its shape should be whatever the LLM reads best.

**The set**, in `FIX-1362/f-mixed/` and `FIX-1366/f-mixed/`:

| File | Job | Reader | Carries |
|---|---|---|---|
| `PR.md` | Decide whether to open the rest | Product owner | People table · one SVG by absolute raw URL · sign-off lines · look here |
| `SPEC.md` | What changes, for whom | Product owner | People table · SVGs with a description each · a `diff` of the file-shaped surface · one mermaid for mechanism · sign-off lines linking into the decisions |
| `DECISIONS.md` | Considered vs chosen, why, locks in, how it evolved | Product owner, then the implementer | Decision tree · a card per decision with its figure · decided-not-asked · dropped alternatives · the round-by-round story |
| `BUSINESS-RULES.md` | The logic cases, as rules a human reviews | Product owner and implementer | Numbered `BR-n` rows: when → then → proved by · the fence and refresh figures · a mermaid *fix or leave* where a sweep needs a stop rule |
| `PLAN.md` | Build it | The implementing agent | Surfaces with IDs and the `BR-n` each serves · a mermaid DAG · checks · pinned names · guardrails with a *because* · at-implement-time |

**On the plan, since the plan is for the LLM.** Three things matter more to an implementing agent than to a person. **Identifiers it can cite**: a `BR-13` it can name in a test description and a PR body beats a paragraph it has to paraphrase. **A dependency graph as text**: mermaid source is structured text an LLM reads directly, so the DAG stays mermaid; an SVG is coordinates to it, so the plan carries none. **Rules with a reason**: a guardrail with a *because* column is followed more reliably than a bare imperative, and it lets the agent recognise when the reason no longer holds. The plan in the mixed set is C's tables with B's DAG and a `because` on every guardrail. What it drops: prose, the people table, every figure.

**Where the figures went.** Each SVG sits with the document that owns its concept: the drawers and the cost stacks in the spec (what changes, what it costs), the layers and refresh grid in the decisions (D1 and D3), the fence in the rules with its mermaid companion beside it, and none in the plan. FIX-1366 got two new figures where position is the content: a before/after wireframe of the front door with the anchor drawn, and a nine-cell coverage grid of the reference.

**The PR-body test.** The figures serve correctly: every URL form tried (`raw.githubusercontent.com`, `github.com/…/blob/…?raw=true`, `github.com/…/raw/…`) returns `image/svg+xml`, which is what GitHub's image proxy needs. **What failed is the write path.** The GitHub tool an agent session posts PR bodies through wraps any URL ending in `.svg` in backticks on write, in all four forms tried: inline markdown image, HTML `img`, reference-style image, and a bare link. GitHub then renders code, not an image. Plain links in the same body are untouched, so this is a deliberate defang of image URLs, and it was not routed around. Two consequences for a template:

- **A person can paste it; the agent can't.** The snippet below is paste-ready. Whether it renders once pasted is the half of the test only a human can run.
- **The `PR.md` files still carry an inline image line**, because that's the shape a template should produce. When the body is posted by an agent, the template needs a fallback: a plain link to the spec's figure, which the tool leaves alone.

One more limit once it does render: an image responds to the *operating system's* colour scheme, not GitHub's theme setting, so a reader running GitHub dark on an OS set to light sees the light figure.

Paste-ready, for PR #1784:

```md
![Refresh, as a grid of files over time](https://github.com/fixpoint-labs/flow-state-dev/blob/claude/spec-pr-doc-formats-trwy46/docs/internal/spikes/spec-formats/FIX-1362/e-svg-poc/figures/refresh.svg?raw=true)
```

**Measured** (prose words, fences excluded):

| | PR | Spec | Decisions | Rules | Plan | Spec + decisions + rules + plan | vs today | Figures |
|---|---|---|---|---|---|---|---|---|
| FIX-1362 · mixed | 387 | 617 | 777 | 963 | 968 | 3,325 | 4,536 · **73%** | 5 SVG · 4 mermaid |
| FIX-1366 · mixed | 359 | 547 | 875 | 810 | 662 | 2,894 | 5,545 · **52%** | 2 SVG · 3 mermaid |

**Read that number honestly.** The mixed set is the longest rewrite in the spike, at roughly three-quarters of the original on the code spec. It's four documents instead of one, and the rules document alone is nearly a thousand words because it says every case once. What changed isn't the total; it's that no reader reads all of it. The product owner reads the PR and the spec (about 1,000 words plus four pictures) and opens the decisions when a sign-off line isn't obvious. The implementer reads the rules and the plan. The rules are the one document both open. If the goal is a shorter *corpus*, this isn't it. If the goal is that nobody reads a book, it is.

## If a shape is picked, what changes

1. `docs/contributing/spec-template.md` → two files: a spec template and a plan template, with the budgets above.
2. `issue-spec` Step 6 writes both: `spec/<ID>.md` and `spec/<ID>.plan.md`, same never-merged branch, both mirrored to Linear.
3. `pr-reviewer-guidance.md` → the layout shrinks to: people table · how · sign-off table · live fork (prose) · look here · links · collapsed contract.
4. `spec-explainer` → epic-only. `issue-spec` stops dispatching it and draws the two panels into the spec instead.
5. `writing-for-humans.md` gains the rules the winner relies on: *no list in boxes*, *diff blocks for file-shaped surfaces, never for internals*, *decisions as cards, forks as prose*, *proof rows state behaviour, not location*.
6. `issue-implement` reads the plan, not Part II.
