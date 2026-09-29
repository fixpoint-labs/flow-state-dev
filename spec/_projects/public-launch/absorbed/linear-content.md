<!-- Verbatim snapshot. Do not edit, reflow, or fold. -->

# Linear project `content`, as read

**Read** 2026-09-29 from the Linear project
[Public Launch](https://linear.app/fixpoint-labs/project/public-launch-2b35a5858733)
· project `updatedAt` **2026-08-24T18:33:54.022Z** · **6005 characters**

Everything below the rule is the field exactly as the API returned it, before the project-spec
mirror replaced it. What was folded into the four documents, and what was left behind, is in the
project PR's body and in the `absorbed:` line of the build report.

The project's separate one-line `description` field is not overwritten by the mirror. It read,
verbatim:

> Close out the remaining work to publish FSD on npm, ship `npx create-flow-state-app`, and clear the docs/polish bar for an official public release.

---

The work between "framework runs" and "framework is launched." Distribution, onboarding, docs polish, and the pre-flight checks that turn a working codebase into something a stranger can `npx` and ship with.

## Definition of launched

Concretely:

1. **Published to npm** — every public package under `@flow-state-dev/*` resolves and installs cleanly. Versioning is coherent (changesets-driven, not hand-edited). READMEs render correctly on [npmjs.com](<http://npmjs.com>). Licensing, repository links, and package metadata are all correct.
2. `npx create-flow-state-app` — a stranger with Node installed runs one command and gets a working, deployable starter. No monorepo clone, no manual wiring. Picks up sensible defaults; works on Vercel out of the box.
3. **Docs bar cleared** — the docs site is good enough that someone landing on it for the first time can build their first flow without external help. Hybrid search works ([FIX-107](https://linear.app/fixpoint-labs/issue/FIX-107/add-hybrid-search-to-docs-site)). No broken links, no half-written guides, no references to deprecated APIs.
4. **Kitchen-sink is demo-quality** — every showcase actually works in the public deploy. UI bugs that make it look unpolished ([FIX-360](https://linear.app/fixpoint-labs/issue/FIX-360/chat-ui-assistant-text-renders-before-the-tool-calls-it-references), [FIX-420](https://linear.app/fixpoint-labs/issue/FIX-420/kitchen-sink-input-toolbar-consolidation-with-menu-and-selection)) are gone.
5. **Brand and positioning are coherent** — landing page, GitHub README, npm READMEs, and docs all say the same thing. Naming and terminology are consistent (no leftover "macro block" references, etc.).
6. **Pre-launch testing in place** — Tier 2 + 3 testing harnesses ([FIX-488](https://linear.app/fixpoint-labs/issue/FIX-488/tier-2-testing-focused-playwright-e2e-for-kitchen-sink-ui-integration), [FIX-489](https://linear.app/fixpoint-labs/issue/FIX-489/exploration-tier-3-testing-real-llm-smoke-suite-paid-cheap-nightly)) exist so we don't ship regressions silently after launch.

## What lives in this project

* Distribution mechanics (npm publish setup, package metadata audits, changesets workflow validation)
* The `create-flow-state-app` CLI itself, and the starter template(s) it scaffolds ([FIX-17](https://linear.app/fixpoint-labs/issue/FIX-17/nextjs-starter-kit) is the obvious starting point)
* Cross-cutting docs cleanup that doesn't belong to a feature project — getting-started flow, navigation, copy polish, broken-link sweeps, search ([FIX-107](https://linear.app/fixpoint-labs/issue/FIX-107/add-hybrid-search-to-docs-site))
* Pre-launch UI polish on kitchen-sink ([FIX-420](https://linear.app/fixpoint-labs/issue/FIX-420/kitchen-sink-input-toolbar-consolidation-with-menu-and-selection), [FIX-360](https://linear.app/fixpoint-labs/issue/FIX-360/chat-ui-assistant-text-renders-before-the-tool-calls-it-references))
* Pre-launch testing infrastructure that hardens the framework against regressions at the moment we open the doors ([FIX-488](https://linear.app/fixpoint-labs/issue/FIX-488/tier-2-testing-focused-playwright-e2e-for-kitchen-sink-ui-integration), [FIX-489](https://linear.app/fixpoint-labs/issue/FIX-489/exploration-tier-3-testing-real-llm-smoke-suite-paid-cheap-nightly), [FIX-214](https://linear.app/fixpoint-labs/issue/FIX-214/claude-skills-for-fsd-testing-and-qa))
* Launch-time showcase work — the "look what you can build" demos that go in the launch post ([FIX-25](https://linear.app/fixpoint-labs/issue/FIX-25/advanced-showcase-pushing-the-frameworks-design-limits) candidates)
* The actual launch itself — coordinating the publish, the announcement, the go-live

## What doesn't live here

* **Framework simplification** — a prerequisite to launch, not part of it. The simplification project ships first; this project ships on top of it.
* **Feature work in active projects** — Plan/Task, Memory, Multi-Agent Patterns, RAG, Persistence, etc. Those land on their own timelines. Launch consumes whatever they've shipped at the launch-cut date.
* **Post-launch growth** — community programs, plugin registry, contribution flows, analytics. Land after we have users.
* **Speculative future work** — workspaces, OpenTelemetry, plugin system, multi-modal, etc. None of this blocks launch.

## Dependencies

* **Framework simplification (in-progress)** — must finish first. Launch ships the simplified framework, not the pre-simplification surface.
* **Wave 1 release-gate items still in flight** in their respective projects — these don't formally block launch, but the launch-cut decision is "is the framework actually ready," not "is the calendar date."
* **Memory (in-progress)** and **Plan / Task Primitive (in-progress)** are both consumed by kitchen-sink showcases; their completeness affects what the launch demo can credibly show.

## Open questions

1. **Package name for the create-app CLI.** `create-flow-state-app`? `create-fsd-app`? Something shorter? Affects `npx` ergonomics and discoverability.
2. **Starter template scope.** Single starter (Next.js + Postgres + Vercel) or pick-from-menu (Next.js / Hono / standalone Node)? Single is faster; pick-from-menu hedges against framework lock-in stories. Recommend single, with the menu as a follow-up if the single-starter constrains adoption.
3. **What goes in v1.0.0 vs v0.x.** Are we committing to semver stability at launch, or shipping as v0.x and reserving the right to break things until v1? Affects how aggressively we polish APIs vs. keep doors open.
4. **Launch surface.** YC application, HN post, X thread, [dev.to](<http://dev.to>) article, all of the above? Different surfaces want different supporting material.
5. **Framework simplification cut line.** Some simplification work could land post-launch without breaking anything. Where's the actual must-be-done line?

## Tracking

This project is the launch checklist. Issues land here when they are launch-blocking; everything else stays in its own project.
