---
name: app-review
description: Multi-agent review of one or more apps built on FSD (labs, kitchen-sink, shift-manager, examples) for usability, UX and the features needed to do real work in them. A lead agent per app maps it, lens sub-agents per app find grounded improvements, and one synthesizer finds the overlaps between apps and decides which belong in a foundation package, in workforce, or in the app. Ends in a visual, interactive report published as an Artifact. Re-runnable: a later run can fold more apps or a new focus into an earlier report. Use when the user asks to review, audit or find improvements across apps, asks "what should move into the packages", or wants a report to seed an epic.
argument-hint: "<apps to review> [focus / concerns] [fold into <report link>]"
---

You run the review: you settle the inputs, launch the `app-review` workflow, check what comes back, build the report and publish it. The workflow (`.agents/workflows/app-review.js`) is the fan-out. `build-report.mjs` merges the results deterministically and renders `report-template.html`. Agents decide what to recommend. The merge, the counts and the page are code, so a re-run can't quietly drop work or misstate totals.

**Read-only on the codebase.** Nothing is filed and no code is changed. Turning the report into Linear issues or an epic is a separate step the user asks for.

## 1. Settle the inputs

Most of what makes a run good comes from turning the user's words into the workflow's `args`. Decide these yourself and note them in a line. Ask only when the set of apps is ambiguous.

| arg | what it is | how to fill it |
|---|---|---|
| `apps[]` | `{ key, name, dir, prefix, about }` per app | `key` is kebab-case. `prefix` is 2–3 capital letters, unique, and becomes the start of each finding id (`CC-USA-3`). `about` is one or two sentences from the app's README, saying what it imitates or exists to prove, so the lead starts oriented. Read each README yourself first; it takes a minute. |
| `focus` | the user's concerns, in their words, made concrete | Goes into **every** agent's prompt and outranks the generic lens text. "Make it usable for daily FSD dev" → name the concrete jobs: review a diff, run checks, link a Linear issue, resume tomorrow. |
| `lenses[]` | `{ key, prompt }`; the defaults are usability, doing-work and robustness | Keep the defaults unless the concern names an axis they don't cover. Then **replace** the least relevant lens rather than add one, since each lens costs one agent per app. See "Adapting to the ask". |
| `minPerLens` | minimum findings per lens agent (default 5) | "at least 10 per app" with 3 lenses → 4. Higher for an exhaustive ask. |
| `prior` | `{ itemsFile, apps }` for fold mode | Use it when an earlier report exists and the user wants more apps or a new angle *added to it*. `itemsFile` is an absolute path to the earlier `data.json`. `apps` lists the earlier run's app keys, so new items can name them. |
| `runTag` | short alphanumeric tag added to finding ids | **Required in fold mode:** `r2`, `r3`, … one past the earlier report's run count. It keeps finding ids distinct across runs, so re-reviewing an app can't collide with its earlier findings. The builder fails if one does. |
| `extraContext` | anything every agent should know | Layering rules the user stated, an epic it feeds, things already decided. |

**Agent count** is `apps × (1 + lenses) + 1`. Two apps with three lenses is 9. Above about 12, tell the user the count before launching, and offer fewer lenses or a split into two runs.

## 2. Fold mode: getting the earlier data

- **Same session:** the earlier run's `<out>/data.json` is still in the scratchpad.
- **Later session:** read the published report with the Artifact tool (`action: "read"`). It saves the page locally. Then run:

  ```bash
  node .agents/skills/app-review/build-report.mjs --extract <saved page> --out <scratchpad>/prior
  ```

  The report page carries its own data, so it is the durable record. The scratchpad is not.

Pass `prior: { itemsFile: "<abs path>/data.json", apps: [<earlier app keys>] }`, and a fresh `runTag`. Lens agents tag findings that match an earlier item. The synthesizer returns *updates* (apps added, evidence, a home or priority change with its reason) plus *new items*, never a rewrite of the earlier list.

## 3. Run it

```
Workflow({ name: "app-review", args: { apps: [...], focus: "...", ... } })
```

Pass `args` as a real JSON object, not a string you built by hand, and never a placeholder. The script throws on a missing `apps`, but a placeholder elsewhere fails silently in the prompts. The run takes roughly 10–15 minutes. Do other work, or end the turn; the completion notification wakes you.

On completion, the Workflow tool's output file (`tasks/<id>.output`) holds `{ result: … }`. `build-report.mjs` reads that file as-is.

- **`lost` is non-empty, or a log line says lens agents were lost:** some coverage is missing. Say which app or lens, and offer to re-run just that part with a narrower `apps`/`lenses`.
- **`synth` is null:** the synthesizer died. Re-run with `resumeFromRunId`; every finished lead and lens agent replays from cache.

## 4. Check before you build (BP-003)

The synthesizer spot-checks, but its output is a claim. Before publishing:

1. Open the files behind the 2–3 **headline** claims (the P1s and anything the summary leads with) and confirm them. Put the check in your reply.
2. Don't repeat totals from the synthesizer's summary prose. They have been wrong before. The page computes every count from the data.
3. `build-report.mjs` exits non-zero when a finding is in no item and not rejected, an update names an unknown item, or an item names an unknown app. Fix the data, or tell the user what was dropped. Don't ship past it.

## 5. Build and publish

```bash
node .agents/skills/app-review/build-report.mjs --workflow <output file> [--prior <prior data.json>] \
  --out <scratchpad>/<run> --title "<a name, 2–4 words>" --date <YYYY-MM-DD> --focus "<the focus, one line>"
```

This writes `data.json` and `report.html`. Optionally, look once at the page in Playwright at desktop and 400px width, light and dark. The template has been checked; look for data that renders badly, not for layout. Then publish `report.html` with the Artifact tool (`icon: "map"` on first publish).

- **Updating the same report**, in fold mode or after fixes: same session, publish the same file path. Later session, pass the report's `url` and `read` it first.
- **A separate report:** a new path.

The page shows:
- the runs' summaries, with the focus of each
- a home × app matrix
- an app × app overlap heatmap
- impact against effort
- themes
- a filterable list of items with a detail drawer
- a package backlog
- each app's raw findings and the lead's description of the app

Items new in a fold run, and items whose home moved, are marked.

## 6. Report back

Use the `no-claudish` shape:
- the link
- the counts, taken from build-report's output line
- the 3 failures the apps share
- the biggest package gaps
- what's already in the packages and only needs adopting
- what you verified, and what wasn't run (the agents read code and don't start apps that need API keys)
- next step: an epic or Linear issues from the package backlog. Offer it; don't file without being asked.

## Adapting to the ask

| The user says | Change |
|---|---|
| "focus on X" (performance, accessibility, onboarding, voice…) | Put X in `focus`. Replace the least relevant default lens with an X lens whose prompt lists X's concrete checks. |
| "compare to <product>" | Put the product in each app's `about`, and add to `focus`: "name the reference product's best move for each gap". |
| "what should be in the framework?" | Keep the lenses. Put in `extraContext` the layering rules that matter (e.g. "react wraps client; engine never depends on client"), so the synthesizer's home decisions follow them. |
| "add apps Y and Z to the last report" | Fold mode (§2). Don't re-review the earlier apps. |
| "just a quick pass" | One lens (`usability` or the focus lens), `minPerLens: 4`. |
| "be exhaustive" | `minPerLens: 8`. Consider a fourth lens. Read every P1's evidence yourself in §4. |
| a specific worry ("the inbox feels broken") | Add it to `focus` verbatim. Lens agents treat it as the first thing to confirm or refute. |

## Files

- `.agents/workflows/app-review.js`: the fan-out. It is pinned by `node .agents/workflows/verify.mjs`, so run that after editing it.
- `build-report.mjs`: the merge, the checks, `--extract`, and the render. It is pinned by `node .agents/skills/app-review/build-report.test.mjs`.
- `report-template.html`: the page. It uses the Shift Manager design system's palette and type (`labs/design-system`) and works for any number of apps. Change it here, not in a run's output, so every later report gets the fix.
