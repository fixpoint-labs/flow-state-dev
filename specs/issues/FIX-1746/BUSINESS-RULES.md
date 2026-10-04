# FIX-1746 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. Each says what a plate or a page does, and the check that proves it. A human reviews this page; the plan turns it into work.

## What a plate may show

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A plate states a boundary: who owns, where it is stored, who can see or use it, what is a copy | The shipped code does exactly that. The PR's claims table cites the code for every such claim, and the test that pins it where one exists | Claims table, read by the reviewer against the cited lines |
| BR-2 | The code and the current page disagree | The plate shows the code. The page prose is corrected to match, in the same PR | Claims table row marked *page corrected* |
| BR-3 | A plate is drawn | It shows homes and walls: boxes inside boxes, who holds what. No numbered steps and no arrows standing for order | Review against the [D2 look](DECISIONS.md#d2) |
| BR-4 | A plate names a thing | Only names the docs or the API already use. No new terms, such as "plane" | `docs-editor` pass; grep of plate text against the page |
| BR-5 | A plate uses an example (`acme`, `alice`, `support.desk`) | The page's prose and code use the same example | Review |
| BR-6 | A plate depends on behaviour an open PR changes | It waits for that PR, or draws only the part that PR leaves alone | [PLAN → At implement time](PLAN.md#at-implement-time) |

## What happens to the page

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | A plate carries a section's boundary | The prose that described it is cut to one paragraph saying what to look at ([D1](DECISIONS.md#d1)) | Section word count before and after, in the PR |
| BR-8 | A sentence states an error code, a limit, a code example, a migration step or a tip | It stays in prose | Review |
| BR-9 | A heading is linked from another page | The heading text and its anchor stay | A grep for inbound `#anchor` links, and no new broken-anchor warnings in the build log. Broken links fail the build; broken anchors only warn |
| BR-10 | A plate is inserted | It has alt text that states its whole content, readable with no image, and one sentence under it saying what to look at | Figure check 3 and review |
| BR-11 | Prose is written or cut | No internal issue or PR numbers, no diff narrative, no "now" or "no longer" ([`user-docs.md`](../../../docs/contributing/user-docs.md)) | `docs-editor` returns SHIP |

## How it looks in each theme

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | The site is in dark mode | The plate uses its dark palette and matches the page | Screenshot of the built page, toggle on dark |
| BR-13 | The site is in light mode | The plate uses its light palette | Screenshot, toggle on light |
| BR-14 | A browser ignores the page's theme and follows the OS | The plate is still legible: it paints its own background | Render with the palettes swapped (figure check render) |
| BR-15 | A plate file is checked | Self-contained: no script, image, link or web font; both palettes in the one file; `aria-label` or title and description; under about 150 lines | Figure check 4: `ext=0 themes≥1 aria≥1` |
| BR-16 | The projects plates' PR has merged | Their five files get the dark palette, style block only | Diff of those files touches only `<style>` |

## Failure taxonomy

A plate claim the code contradicts is fixed in the plate, never in the code; if the code looks wrong, that is a separate issue, filed and linked. A failing docs build blocks the PR. A plate whose behaviour is still moving in an open PR is deferred, not guessed. `docs-editor` returning anything but SHIP after three rounds goes to the coordinator.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): every page in the ranked list carries its plate or reuses one, with its prose cut to match; every boundary claim is cited to the code; the site builds; both themes are shown from the built site; and the figure check reports `themes=0` on a light-only plate, which is the control.
