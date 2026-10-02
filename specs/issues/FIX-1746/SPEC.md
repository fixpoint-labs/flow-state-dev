# FIX-1746 · Docs: boundary-style SVGs for Workforce + user docs (more diagrams, fewer words)

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **opens Channels to learn what a channel is** | Reads four paragraphs to work out that members live in session state, lines are items, and the board is somewhere else | Sees one plate with three walls, and reads one paragraph |
| **hires a seat for one person** | Assembles who can list it and who can call it from bullets spread over two sections | Reads it off one plate: who can see it, who can use it, what answers outside the org |
| **reads the inventory beside the roster** | Has to notice that one forgets on fire and one never does, and that a copy is not the check | Sees each record's home and which ones are copies |
| **learns state scopes in Fundamentals** | A table of lifetimes, then 300 words on who shares what | A plate of who shares each scope and what the browser can see |
| **reads the docs in dark mode, the site's default** | Will meet the projects plates as white panels on a near-black page | Every plate matches the page theme |

## The goal, and how we'll know it's met

**A builder reading Workforce and the core docs can tell, from one picture per confusing boundary, who owns each piece, where it is stored, and what is only a copy, and those pages say it in fewer words.**

| Is it the right goal? | |
|---|---|
| **The real need** | Boxes and walls "make the model click faster than flowcharts or long paragraphs"; same treatment elsewhere, then cut the prose ([FIX-1746](https://linear.app/fixpoint-labs/issue/FIX-1746)) |
| **Smaller, and rejected** | "Add some SVGs to Workforce pages." Leaves the prose that repeats them and skips the core docs, so readers still wade |
| **Bigger, and not this issue's** | Restructuring the docs site, the Atlas pages, or a diagram generator |
| **Not done if** | A plate shows something the code doesn't do · a plate sits on top of unchanged prose · a plate is a white slab in dark mode · alt text says "diagram" · a cut breaks a link from another page |

**No goal check applies:** no behaviour changes, so nothing runs on the real path. Per PR, the proof is: the site builds; every plate claim cites its code and pinning test; both themes are screenshotted from the built site; and `docs-editor`, blind to the code, answers each plate's questions from the plate alone. Control that must fail: the figure theme check over a light-only plate, such as today's projects plates, reports `themes=0`.

## What changes

![The opening of the Channels page, before and after: four paragraphs and about 155 words with no picture, against one three-walled plate and one paragraph of about 45 words](figures/what-changes.svg)

One section, before and after. The plate replaces the paragraphs that described where things live. The tip box and the rest of the page stay.

The two plates below are drawn for approval of the look. Each is the plate its page will carry, checked against the code ([PLAN → Claims](PLAN.md#claims-checked-for-the-two-drawn-plates)).

![A channel is a session; its board is not. Three walls: registered flows, engine sessions, organization data, with a Not a copy footer](figures/channel-parts.svg)

Read it by wall. What sits in the middle box belongs to one channel's session; the board rows and the inventory row are the organization's.

![Who can see a hired seat and who can use it: an org-visible and a user-owned seat inside acme, and what everyone outside acme gets](figures/hired-seat-reach.svg)

Read across each column, then compare. Seeing a seat and using it are two separate checks.

**On a page, the change looks like this:**

```diff
  ## What a channel is
- A **flow kind** is a definition you register. A **session** is one conversation …
- A channel is a session, not a new type beside flows and collections. …
- If you arrived from workers on disk, … lives in each session's own state.
- Session state is also why the conversation stays in one place. …
+ ![Where each part of a channel lives …](./channel-parts.svg)
+
+ A channel is a named session on the one `channel` kind the framework ships. …
```

## Pages, in order of confusion

| Rank | Page | Plates | PR |
|---|---|---|---|
| 1 | Workforce → Channels | where a channel's parts live | 1 |
| 2 | Workforce → Inventory | the records about a seat and a channel, and which are copies | 1 |
| 3 | Workforce → Hiring at runtime | who can see and use a hired seat · where a seat keeps what it learns about a person | 2 |
| 4 | Workforce → Overview | what Workforce adds, and what stays the flow's | 2 |
| 5 | Workforce → Documents on disk | references are fenced by folder; resources are not | 3 |
| 6 | Workforce → Components | where each component reads from | 3 |
| 7 | Fundamentals → State & scopes | who shares each scope, and what the browser sees | 4 |
| 8 | Fundamentals → Flows | what the definition owns, what each copy owns, whose session it is | 4 |
| 9 | Getting started → Your first flow | where each piece runs and is stored | 4 |
| 10 | Guides → Board lifecycle | a board is stored rows plus a drain that runs | 5 |

Four more pages reuse one of these plates rather than get their own. The guide-style pages live in `apps/docs/guides/` on their own sidebar, not under `docs/`. The full per-page list, including the pages that get no plate and why, is in the [plan](PLAN.md#surfaces).

## What stays as it is

- Every product behaviour and every line of code. Docs and SVG only.
- The projects page and its plates, which belong to the projects work in review. Once that merges, its five plates get the dark palette and nothing else.
- Atlas pages, sidebar order, page titles, and every heading another page links to.
- Error codes, limits, code examples and migration steps stay in prose.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** a plate per confusing boundary, prose cut where the plate carries it, Workforce and the core docs. If wrong: we ship pictures beside unchanged text, or chase pages nobody trips on.

1. **[D1](DECISIONS.md#d1) · Cut the prose a plate carries to one paragraph.** If wrong: a plate that drifts from the code takes the page's only statement of that boundary with it.
2. **[D2](DECISIONS.md#d2) · Plates follow the page's light or dark theme, in one file, instead of copying the projects plates' light-only look.** If wrong: we restyle sixteen small files.
3. **[D3](DECISIONS.md#d3) · Five small PRs, Workforce first, one to three plates each.** If wrong: five review sittings where two would have done.

**Open: none.** Nothing to decide beyond direction; D1 is the one to weigh.

Docs · `apps/docs` only · 11 new plates on 10 pages, 4 more pages reuse one · 5 PRs · no epic
