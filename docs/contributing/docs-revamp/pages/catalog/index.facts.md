# Facts for Catalog (K-01, catalog)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec is cited. Paths are from the repo root.

Legend: **[page]** the page states it. **[ref]** belongs on a Reference or kit page; the Catalog links, does not state it. **[gap]** nothing citable exists; the page must not assert it. **[reconcile]** a name or path that depends on a surface not yet settled; mark for cutover.

Abbreviations: `dk` = `packages/core/src/kit/define-kit.ts` · `wk` = `packages/workforce/src/kit/workforce-kit.ts` · `hk` = `packages/harness-manager/src/kit/harnesses-kit.ts` · `cc` = `packages/claude-code/src/sdk/kit.ts` · `lr` = `labs/README.md` · `er` = `examples/README.md` · `sm` = `packages/shift-manager/README.md` · `eo` = `apps/docs/docs/ecosystem/overview.md` (the page this one replaces) · `et` = `packages/engine/src/flowstate/types.ts`.

## Flags against the page plan (read first)

1. **No registry, listing or publishing path for community kits exists on the public surface.** No source, README, doc page or test names a "community" shelf, a kit registry, a naming convention for published kits, or a command that lists or installs one. Grep of `apps/docs/docs`, `packages/*/README.md` and `packages/core/src/kit` for "community" finds only unrelated hits (`apps/docs/docs/patterns/utility-blocks/core.md`, `fundamentals/blocks.md`, `sequencers/connectors.md`). Question 3 ("where would a kit you published appear?") has **no citable answer**. **[gap]** The page can state only what is observable: a kit is a value `defineKit` returns, an app lists it in `kits`, and a package that exports one is installed like any other package (facts 3.1 to 3.4). Whatever the shelf is called, the sheet cannot say it is curated, listed or searched. Escalate to the caller; do not invent.
2. **No starter has an install path from a published package.** The apps the plan calls starters live in `labs/`, and every lab's `package.json` is `"private": true` (`labs/claude-code-style/package.json:4`, `labs/teammates/package.json:4`, `labs/knowledge-hub/package.json:4`, `labs/design-system/package.json:4`, `labs/fsd-coding-skill/package.json:4`). No `fsdev` command scaffolds an app from one (`packages/fsdev/src/commands` and `packages/fsdev/README.md` have no `init`, `create`, `starter` or `template` command; the README's only scaffolding mention is a skill and `CANONICAL_NEXT_STEPS`, `packages/fsdev/README.md:515`). So a starter today is a folder in the repository to read and copy. **[gap]** for any "install it" line; **[reconcile]** the install path is the plan's unsettled item, so the Catalog states the shelf's meaning and where the apps are, not a command.
3. **Starter names.** Teammates (`labs/teammates`) and the Claude Code-style app (`labs/claude-code-style`) are in `labs`; the second's name is the plan's placeholder. **[reconcile]** Shift Manager is a published package, not a lab (see 4.5).
4. **Kit import paths are scattered.** `workforce` is exported from `@flow-state-dev/workforce/kit`, `harnesses` from `@flow-state-dev/harness-manager/kit`, `claudeCode` from the root of `@flow-state-dev/claude-code` (facts 3.5 to 3.7). The page names the kits and their packages only. Config keys stay off the page (plan: unsettled, reconciled at FIX-2705). **[reconcile]**
5. **Codex and Cursor are not kits.** Each exports a plain harness value (`codexHarness`, `cursorHarness`) that the app puts in the harnesses slot. Claude Code is a kit. (fact 3.8). The page must not put Codex or Cursor on the Kits shelf as kits.
6. **Stored data.** The Catalog page stores nothing and names no stored part; the four questions (owner, visibility, storage, count) do not apply. Where a facts-worthy stored part appears, it belongs to the kit's own page (e.g. the workforce kit's `workforce/` folder, `wk:174-184`). The page states none of them.

## 1. What is on the page now (the page it replaces)

- The current Ecosystem overview says the section covers things "built on top of that runtime, but isn't part of it", that you can ship a flow without any of them, and that "Ecosystem packages can be swapped, replaced, or skipped". `eo:7-9`. **[page]** (as the meaning of "library")
- It lists five things: Patterns (`planAndExecute`, `supervisor`, `parallelTasks`, `eventActors`, built on `task-board`), Tools (`fetch`, `crawl`, `bash`, MCP), Skills ("model-routed instructions"), UI (a React component registry) and Memory (`@flow-state-dev/memory`, tiers working, episodic, semantic, digest, behind a single `system()` factory). `eo:13-21`. **[page]** (as the library rows; verify each against the package in section 4)
- It says "A full map of the ecosystem is still being assembled" and sends readers to package READMEs. `eo:25`. **[gap]** nothing to keep; this is the hole the Catalog fills.
- "The CLI and DevTool live in Core under Dev tools". `eo:23`. **[page]** only if the page needs to say the CLI is not a library on the shelf. Optional.

## 2. Starters

- `labs/` holds "Applications built on `@flow-state-dev` for real-world use — not teaching snippets, not framework reference apps", "past the 'minimal example' stage but not a shipped product: still research software". `lr:3-7`. **[page]**
- The labs table lists, among others: `claude-code-style/` ("A Claude Code-style app on the workforce package: sessions on the left, the main thread in the center, background tasks on the right. Built from configuration, React UI and small flows only." `lr:21`), `teammates/` ("A Grok Bot-style app on the workforce package: a list of workers on the left, each with one long conversation, and workers that message each other where you can see it." `lr:24`). `design-system/` is "The light and dark theme Shift Manager loads", values only, no components (`lr:22`); `knowledge-hub/` is incubation (`lr:23`). Only the first two are apps a reader would reshape. **[page]**
- For both, "Session mode runs on the real packages with a real model; threads mode waits on its wiring." `lr:21`, `lr:24`. **[page]** (a one-clause limit: part of each is not wired yet; the starter pages carry the detail **[ref]**)
- Shift Manager "is published as `@flow-state-dev/shift-manager`". `lr:26-27`. It is the browser app a Workforce team is worked through, and "knows nothing about any particular Lab". `sm:1`, `sm:7`. **[page]**
- Install and run Shift Manager: `npm install @flow-state-dev/shift-manager` then `npx shift-manager --config ./fsdev.config.mts`. `sm:16-17`. It is "research software"; several screens are placeholders. `sm:9`. **[page]** (the one install line a starter has; the second of these is a command, not a scaffold)
- `examples/` is "Minimal, focused, pedagogical snippets"; `hello-chat/` is "Minimal chat flow — generator + handler + sequencer in ~50 lines, with a Next.js chat UI. The best starting point." `er:3`, `er:9`. It is an example, not a starter, though a reader wanting a whole small app to copy reaches it first. **[page]** (one clause; link to Quick start `apps/docs/docs/getting-started/quick-start.md`)
- To start your own app from an example, copy its folder outside the repository, rewrite each `workspace:*` dependency to `latest` and install. `er:19-35`. A lab's package is private and its `@flow-state-dev/*` dependencies are workspace-only the same way. **[ref]** (the "Copy an example out" steps belong on a starter page, not the Catalog; the Catalog links)
- Question 1 (whole app to reshape: which shelf?) is answered by the definitions above: an app you copy and change is a starter. Derived, not stated in any source. **[page]**

## 3. Kits

- A kit "packages a feature so an app installs it with one config object", for example `createFlowState({ kits: [workforce({ model }), harnesses({})] })`. `dk:4-6`. **[page]**
- 3.1 A kit declares "what it needs (`config`, the kits it `requires`), the typed places other kits fill (`slots`), what it fills in the kits it requires (`contributes`), an optional folder it owns in the app (`directory`), and an `install` that returns the flows it serves." `dk:6-9`. **[page]** (the first clause only; the rest is Kits and slots)
- 3.2 A kit "composes existing pieces: resources, views and capabilities ride on the flows the install returns." `dk:9-11`. **[page]**
- 3.3 The app lists kits in `createFlowState({ kits })`, "each a kit's factory called with its config, in any order". `et:126-130`. They "install in `requires` order". `et:129`. **[page]**
- 3.4 An app can fill a kit's slots itself: `fill: { [harnesses.slots.harnesses]: [codexHarness(), cursorHarness()] }`. `et:140-145`. **[ref]**
- 3.5 **Workforce** (`@flow-state-dev/workforce`, `0.5.0`): `workforce` is a kit named `workforce`, exported from `@flow-state-dev/workforce/kit` (`wk:174-184`; subpath `packages/workforce/package.json:45-48`). It "reads the app's `workforce/` folder", "builds the worker model over the workers it declares, and serves one copy of each worker flow and the roster flow". `wk:4-9`. Its slots: `workerFlows`, `uses`, `flows`. `wk:176-180`. Example: `createFlowState({ kits: [workforce({ agent: { model: "openai/gpt-6-luna" } })], stores })`. `wk:172`. **[page]** (name, package, one-line what-you-get; slots and config **[ref]**)
- 3.6 **Harnesses** (`@flow-state-dev/harness-manager`, `0.5.0`): `harnesses` is a kit named `harnesses`, exported from `@flow-state-dev/harness-manager/kit` (`hk:96-97`; subpath `packages/harness-manager/package.json:42-45`). It requires `workforce` (`hk:98`), declares one slot, `harnesses` (`hk:100`), and contributes to workforce a `coder` worker flow and which harnesses can run here. `hk:9-17`, `hk:101-108`. It serves one flow, `harnesses`, with a `readiness` view of one row per harness filled. `hk:19-21`, `hk:117-120`. **[page]** (name, package, one line; `workspace` config and the rest **[ref]**)
- 3.7 **Claude Code** (`@flow-state-dev/claude-code`, `0.3.1`): `claudeCode` is a kit named `claude-code`, exported from the package root (`cc:72-73`; `packages/claude-code/src/sdk/index.ts:80`). It requires the harnesses kit (`cc:74`) and fills the harnesses slot with Claude Code, plus a `claude-code-plan` entry when `plan: true`. `cc:76-82`, `cc:6-14`. **[page]**
- 3.8 **Codex and Cursor are harness values, not kits:** "Codex and Cursor are plain harness values, since they install nothing." `cc:4`. `codexHarness` is exported from `@flow-state-dev/codex` (`packages/codex/src/index.ts:14`), `cursorHarness` from `@flow-state-dev/cursor` (`packages/cursor/src/index.ts:16`). They go in the harnesses slot. **[page]** (one clause, so a reader looking for a Codex kit finds the answer)
- 3.9 Each of the three kits is published (`private` unset): `packages/workforce/package.json`, `packages/harness-manager/package.json`, `packages/claude-code/package.json`. The three kits above are the only `defineKit` callers in `packages/*/src` (grep: `packages/workforce/src/kit/workforce-kit.ts`, `packages/harness-manager/src/kit/harnesses-kit.ts`, `packages/claude-code/src/sdk/kit.ts`). **[page]** (the page lists three kits; it must not imply others exist)
- 3.10 Install lines for the kits' packages: `pnpm add @flow-state-dev/harness-manager` (`packages/harness-manager/README.md:10`); Codex `pnpm add @flow-state-dev/codex @openai/codex-sdk@0.164.0` (`packages/codex/README.md:19`); Cursor `pnpm add @flow-state-dev/cursor @cursor/sdk@1.0.40` (`packages/cursor/README.md:18`). Workforce and claude-code have no install block in the lines read; **[verify]** before the page prints an install line for them, or print none (the page plan says the install lines wait on FIX-2627).
- 3.11 The Catalog's kit table is therefore three rows: workforce, harnesses, claude-code. Question 2/1 split: a reader wanting "a feature to install into an app, opened by slots" is on this shelf. Derived from 3.1 to 3.9. **[page]**

## 4. Libraries

A library is a package with no kit: you import functions or blocks from it. Facts below confirm what each package is, and that it exports no kit (`grep defineKit packages/*/src` hits only the three kit packages, fact 3.9).

- `@flow-state-dev/tools`: "Portable tool blocks for `@flow-state-dev` flows. Each tool is a handler block that can be passed directly to a generator's `tools` array." `packages/tools/README.md:3`; `pnpm add @flow-state-dev/tools` `:8`. **[page]**
- `@flow-state-dev/memory`: "Cross-turn memory for agents built on `@flow-state-dev/core`. One factory, four optional tiers (working, episodic, semantic, digest), and a capability you wire into a generator with one line." `packages/memory/README.md:3`; "This package is its own install. **It is not part of core.**" `:5`; `pnpm add @flow-state-dev/memory` `:10`. **[page]**
- `@flow-state-dev/patterns`: "Reference implementations of established AI composition patterns" `packages/patterns/README.md:3`; `pnpm add @flow-state-dev/patterns` `:10`. Named patterns on the old page: `planAndExecute`, `supervisor`, `parallelTasks`, `eventActors` (`eo:13`). **[page]**
- `@flow-state-dev/orchestration`: three layers: the task substrate, the task board, and skills (`SKILL.md` folders injected as inline instructions). `packages/orchestration/README.md:3-12`; `pnpm add @flow-state-dev/orchestration` `:19`. **[page]**
- `@flow-state-dev/workspace`: "Project files from resource collections into a directory an agent works in, and reconcile them back when it's done." `packages/workspace/README.md:3`; `pnpm add @flow-state-dev/workspace` `:8`. The harnesses kit takes it as a config value (`hk:90-93`, import `hk:24`). **[page]**
- `@flow-state-dev/ui` is `"private": true` (`packages/ui/package.json:4`); it is not installable from the registry as written. The old page lists UI as an ecosystem member (`eo:19`). **[verify]** before the page lists it on a shelf of installable libraries; the safe line is to omit it or link to the UI docs section (`apps/docs/docs/ui/overview.md`).
- Other non-kit published packages exist (`store-sqlite`, `store-postgres`, `vercel`, `next`, `node`, `bullmq`, `mcp`, `scheduled`, `voice-openai`, `testing`, `react`, `client`), per `packages/*/package.json` descriptions. They are runtime, storage, transport or client packages; whether the Catalog shelves them or leaves them to Reference is the plan's call. **[verify]** The page lists only libraries it can name from a README with an install line.
- Question 2 (one function to import: which shelf?) answer: Libraries, because nothing is installed into `createFlowState({ kits })`; you `import` and call. Derived from `dk:4-6` and 4.x above. **[page]**

## 5. From the community

- **Nothing citable.** See flag 1. The only observable statements are: a kit is the value `defineKit` returns (`dk:1-11`), an app installs any kit by listing it in `kits` (`et:126-130`), and the package that exports it is installed like any package (fact 3.10 for the shape). **[gap]**
- Where a published kit would appear is **not stated in any source**. Do not name a registry, a tag, a list or a page. **[gap]**

## 6. Which one do I want (derived from the above)

- You want a whole app to open, run and reshape: a starter (sections 2). Derived from `lr:3-7`, `er:3`. **[page]**
- You want a feature to add to an app you already have, that brings its own flows and leaves slots for others: a kit (3.1, 3.3). **[page]**
- You want a function or block to import with nothing installed into `createFlowState({ kits })`: a library (section 4). **[page]**
- A starter installs kits: the two apps are "on the workforce package" (`lr:21`, `lr:24`), whose feature is a kit (3.5). **[page]**
- A library never has slots or a folder; a kit may. `dk:6-9`. **[page]**

## 7. What the page will not state (limits, flat)

- Starters are research software with known gaps: each has a part "waiting on its wiring" (`lr:21`, `lr:24`; `sm:9`). **[page]**
- No scaffold command and no published starter package for a lab (flag 2). **[page]** as "run it from a copy of the repository folder" only if a starter page confirms the path; otherwise state nothing.
- Kit factories and config keys are not final (the plan marks them unsettled). Do not print a config shape other than the doc comment's `workforce({ agent: { model: "openai/gpt-6-luna" } })` (`wk:172`). **[reconcile]**

## Reader questions: answer key (for pass 2)

1. A whole app to reshape: Starters. Evidence: sections 2 and 6.
2. One function to import: Libraries. Evidence: section 4 and 6.
3. A kit you published: **unanswerable from citable sources** (flag 1). Pass 2 must either drop the question or mark the answer as a gap for the owner.

## Revise round 1

- Shift Manager is no longer a Starters row: a starter is copied, Shift Manager is run as it is (`sm:16-17`). It has its own paragraph after the table: run it, what it does (`sm:3-5`), research software with placeholder screens (`sm:9`). Starters definition unchanged.
- The "session mode / threads mode" sentence is now "parts of each are not wired up yet" (`lr:21`, `lr:24` say threads mode waits on its wiring).
- Install-order rule and `fill`/slot-kind detail moved to R-11 (`reference/kits`): each kit installs after the kits its `requires` names; kits `requires` does not order keep the order listed in `kits`; a required kit must itself be listed in `kits` or the app refuses to start. A harness can be a kit that fills the `harnesses` slot (`claudeCode`) or a plain value you fill yourself (`codexHarness`, `cursorHarness`); plain values install nothing (`cc:4`). The page keeps "list them in any order" and one clause naming Codex and Cursor, linked.
- Install command is `npm install` throughout, matching `sm:16`; library READMEs show `pnpm add`, equivalent.
- `readiness` view: one row per harness filled, checked for whether each is ready (`hk:16-18`).

## Revise round 2

- Workforce row: "a roster flow and one flow per worker" (`wk:4-9` serves the roster flow and one flow per worker); no claim about how a flow is built.
- "not wired up yet" is now "not wired up" (`lr:21`, `lr:24`).
- Libraries intro no longer says "no kit" and "nothing goes into `kits`" separately; the second states it.
- Closing line: both labs starters are built on the `workforce` kit (`lr:21`, `lr:24`; 3.5).
