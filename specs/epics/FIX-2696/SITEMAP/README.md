# FIX-2696 · Sitemap: every page of the new docs

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · **Sitemap**

The page plan. Every page of the new site is named here with its job, its contents, the questions
a reader must be able to answer after it, its figures and examples, what it leaves to Reference,
where its material is today, and the issue that writes it. The owner signs this off with the
epic PR. It is a plan: a page's contents can move when its fact sheet is written, and a change
that adds, drops or re-homes a page is an amendment here first.

| Section | File | Pages | Planned words | The spec's estimate |
| --- | --- | --- | --- | --- |
| **Start** | [`start.md`](start.md) | 5 | 3,400 | 5 pages, about 5,000 |
| **Concepts** | [`concepts.md`](concepts.md) | 23 | 22,500 | about 20 pages, about 25,000 |
| **Catalog** | [`catalog.md`](catalog.md) | 43 | 37,850 | about 25 pages, about 35,000 |
| **Build** | [`build.md`](build.md) | 37 | 31,450 | about 25 pages, about 25,000 |
| **Reference** | [`reference.md`](reference.md) | 43 hand-written, 27 generated sections | no budget | about 25 tabular pages |
| **Hand-written prose, all four** | | 108 | **95,200** | about 90,000 |

## Against the two targets

- **Start + Concepts: 25,900 planned words against 30,000.** Inside the target with 4,100 to
  spare. The margin is real only if pages hold their planned size: 23 concept pages at the
  1,500-word budget would be 34,500 on their own. FIX-2705's closure check measures the total,
  not each page's budget.
- **All hand-written prose: 95,200 against about 90,000.** Over by about 5,200, or 6%. The
  estimate counted about 75 pages; naming every page gives 108, because each of the audit's
  "keep" verdicts is a page: eight patterns, six tools, four memory pages, twelve deploy,
  webhook and schedule recipes. The overshoot is in Catalog (+2,850) and Build (+6,450). The owner
  accepted it on 2026-11-12 (the first decision below).

"Planned words" is prose only, as `scripts/check-docs-page.mjs` counts it: no code, no
frontmatter, no figure descriptions.

## Reading order

A newcomer reads Start and Concepts in this order and looks things up in the rest.

```text
S-1 What Flow State is ─ S-2 Run a starter ─ S-3 Make it yours ─ S-4 Build with your coding agent
                                                                        │
C-01 How it fits together ──────────────────────────────────────────────┘
  The model         C-02 Blocks ─ C-03 Generators and tools ─ C-04 Composition ─ C-05 Flows and actions
                    C-06 Sessions, items and streaming ─ C-07 State and scopes ─ C-08 Resources
                    C-09 Views ─ C-10 What the browser sees ─ C-11 Capabilities ─ C-12 Kits and slots
  Running it        C-13 Serving flows ─ C-14 Persistence ─ C-15 Pausing, resuming and surviving a crash
                    C-16 Background work ─ C-17 Auth and tenancy ─ C-18 Models
                    C-19 When something fails ─ C-20 Testing
  Getting work done C-21 Tasks and boards ─ C-22 Workers ─ C-23 Coding harnesses
```

S-5, Add to an existing app, is a second door beside S-2 for a reader who already has a product.
It joins the same path at C-01. B-01, Your first flow, is the hands-on companion to C-02 to
C-07 and is linked from S-3 and C-01.

The order inside the model is the order of dependency: each page uses only what earlier pages
taught. Kits and slots comes last in the model because it is built from everything before it,
and first in the reader's experience, which is why S-1 and C-01 introduce it in a paragraph.

## One home for each topic

The audit's duplication table, and where each topic lives after. One page explains; the others
link.

| Topic | Today | Explained on | Detail in | Built in |
| --- | --- | --- | --- | --- |
| Tasks and boards | 9 pages, about 38,000 words | C-21 | R-23, R-24 | B-02; patterns K-19 to K-28 |
| Coding agents | 6 pages, about 33,000 | C-23 | R-27 | K-14 to K-17 |
| The client | 7 places, about 31,000 | C-10 | R-14, generated `client` and `react` | S-5, B-01 |
| Pause, resume, retry | 9 pages, about 15,500 | C-15 | R-17, R-18 | B-03 |
| Background work | 6 pages, about 12,700 | C-16 | R-19 | B-19 |
| State writes | 4 pages, about 12,000 | C-07 | R-07 | B-01 |
| The hello-chat app | Built four times, about 6,800 | B-01 | | B-01 |
| The `createFlowState` and Next handler snippet | 7 pages | C-13 says what it does | R-12 | S-5 prints it, once |
| Approvals | 8 files | C-15 | R-17 | B-03 |

The check FIX-2705 runs: for each row, no page other than the ones named explains the topic,
and every other mention is a link.

## How to read an entry

```text
### C-07 · State and scopes                      id · title
`concepts/state-and-scopes` · concept · 1,100 words    slug on the site · page type · planned prose
Job.            One line: what the page is for.
Contents.       The H2 headings in order, separated by "·". H3 headings follow their H2 in brackets.
After reading.  Three to five cold-read questions. Pass 2 of the writing loop starts from these.
Figures.        A brief each: what it shows, what it adds over the prose, which shared marks it uses.
Examples.       One line each: what it demonstrates, and the API it uses.
Links to.       The Reference pages and other pages it points at for what it leaves out.
Sources.        Today's pages, with the audit's verdict.
```

Ids: **S** Start, **C** Concepts, **K** Catalog, **B** Build, **R** Reference. Slugs are paths
under the site's `docs/`. Until cutover the files live in `docs/contributing/docs-revamp/pages/`
(D3). Shorter formats are used where a template fixes the outline: Catalog entries, recipes and
Reference pages say so at the top of their file.

**Who writes what.** FIX-2702 Start · FIX-2701 Concepts · FIX-2703 Catalog · FIX-2704 Build ·
FIX-2699 hand-written Reference · FIX-2698 generated Reference · FIX-2700 publishes every page
as Markdown · FIX-2705 moves the pages, redirects every old URL and runs the closure checks.
FIX-2697 owns the rules all of them follow.

## Figures across the plan

About 90 drawings and 8 screenshots: Start 5, Concepts 39, Catalog 33, Build 8, Reference 5.
Every drawing follows [`FIGURES.md`](../../../../docs/contributing/docs-revamp/figures/FIGURES.md),
and each brief names its marks in that file's words: hatching (outlives the request), dashed
outline (lasts one action run), highlighter (the one idea), arrow (a relation the key names),
dashed arrow (only under a condition), red (an exception), layer boxes, a box in a box, columns.

Five figures recur on purpose, so a reader recognises them:

| Figure | First drawn on | Reused on |
| --- | --- | --- |
| The layer stack | S-1 | C-01, with a request threaded through it |
| A list and a loop | C-21 | B-02 |
| A run that stops and starts | C-15 | B-03 |
| The kit chain | C-12 | B-04, K-03 |
| A supervised run | C-23 | K-14 |

Every kit page opens with the same *what this installs* figure, and every pattern page with its
shape on one shared grid.

## What is not settled

A page that depends on one of these says so in its entry, and does not invent the answer.

| Open | Pages it holds | Who settles it |
| --- | --- | --- |
| How a starter is installed (O2) | S-2, S-4, B-05, K-02 to K-04 | Product work outside the set |
| The Claude Code-style starter's name | K-03 | The owner |
| Kit factories and config keys: `workforce()`, `harnesses()`, `claudeCode()` | S-1, C-12, C-22, C-23, K-05 to K-17, B-04, R-11, R-25, R-27 | FIX-2627; reconciled at FIX-2705 (ER-8) |
| ~~Codex and Cursor: kits, or fills of the harnesses slot~~ Settled by FIX-2627's approved spec: fills of the harnesses slot | C-23, K-16, K-17 | Settled |
| "Lab": defined once on K-04, or dropped | K-04 | The owner |
| Option names for queued runs and dispatch | C-16 | The page's fact sheet |

## Decided by the owner, 2026-11-12

These were the plan's three questions for the owner. Each is settled; a writing child works from
the answer and does not reopen it.

1. **The plan stays at 95,200 words, about 6% over the 90,000 estimate.** Accepted as written: the
   overshoot comes from naming every page the audit kept. The measure that protects the newcomer
   is Start + Concepts under 30,000, and that holds. The six tool pages and the three scheduler
   recipes are not merged.
2. **Concepts keeps all 23 pages, not 20.** The three added are What the browser sees, When
   something fails, and Testing, each from an audit verdict that needed a home. Testing and When
   something fails are not folded into Build as recipes.
3. **`guides/projects-on-org-scope` is cut,** where the audit said "rename or cut". "Project"
   already means a Workforce project, and C-07 and C-17 cover organization-wide data.
