---
name: add-docs-page
description: Add a new page to the flow-state-dev documentation site (Docusaurus). Handles frontmatter, sidebar placement, content structure, and cross-linking.
argument-hint: "<topic and section, e.g. 'guide for creating custom store adapters in the persistence section'>"
---

You are a development agent adding a new page to the flow-state-dev documentation site. The docs site is built with Docusaurus and lives in `apps/docs/`.

## Core Principle

**Docs are for developers building apps WITH the framework.** Write for an engineer who knows TypeScript and React but has never seen flow-state-dev before. Introduce concepts when you first mention them. Don't assume prior context.

## Workflow

### Step 1: Determine Page Location

Parse $ARGUMENTS to identify:
1. What topic does this page cover?
2. Which section does it belong in?

The docs site has two content areas with separate sidebars:

**Docs** (`apps/docs/docs/`, sidebar: `apps/docs/sidebars.ts`):

```
apps/docs/docs/
  getting-started/      # Onboarding, installation, first flow
  fundamentals/         # Core concepts (blocks, flows, state, actions, capabilities)
  sequencers/           # Sequencer DSL, composition, connectors
  resources/            # Resources, storage, collections, client-access
  patterns/             # Composable patterns (coordinator, supervisor, plan-and-execute, reactive-blackboard)
    utility-blocks/     # Core and extension utility blocks
  streaming/            # SSE, item model, resume
  server/               # Server setup, model resolver, model groups
  client/               # Client API, React hooks
  persistence/          # Store adapters, data model
  tools/                # Tool blocks (fetch, crawl, bash, mcp)
  testing/              # Test harness, mocking
  cli/                  # CLI reference
  devtool/              # DevTool setup and usage
  api/                  # API reference per package
```

**Guides** (`apps/docs/guides/`, sidebar: `apps/docs/sidebarsGuides.ts`):

```
apps/docs/guides/
  anatomy-of-a-flow.md
  building-a-chat-app.md
  nextjs-setup.md
  development-tips.md
  building-agents.md
  deployment.md                # Deployment overview
  deploying-to-vercel.md       # Vercel-specific guide
  deploying-to-railway.md      # Railway-specific guide
  deploying-with-docker.md     # Docker-specific guide
```

Guides appear as a separate "Guides" nav item, not inside the Docs sidebar.

If unsure which section, read the existing pages in candidate sections to find the best fit.

**Who runs this.** This skill is the page *mechanics* — section choice, frontmatter, sidebar
registration, cross-linking. The prose itself is the `docs-writer` agent's, and when a page is being
added as part of a code change it must be, because whoever holds the spec and the diff leaks them
into the writing. If you're the implementer, dispatch `docs-writer` (which follows this skill for
placement) and then `docs-editor`, rather than writing the page here.

### Step 2: Read Reference Pages

Read 1-2 existing pages from the target section to understand:
- Frontmatter conventions (title, sidebar_position, description)
- Content structure and depth
- Code example style
- How concepts are introduced

Good reference pages for current conventions: `tools/bash.md`, `tools/mcp.md`, `resources/client-access.md`. These reflect the most recent style and structure.

Also read `CLAUDE.md` for the **Writing Style** section — it defines the voice for all docs content.

### Step 3: Write the Page

#### Frontmatter

```markdown
---
title: <Page Title>
sidebar_position: <number>
description: <One sentence describing what this page covers.>
---
```

`sidebar_position` determines ordering within the section. Check existing pages to find the right slot.

#### Content Structure

Follow this general structure (adapt as needed):

1. **Opening paragraph** — What this page covers and why it matters. No "In this guide, we will..." Just say what the thing is and what it does.

2. **Concept introduction** — If this page introduces new concepts, explain them plainly before showing code. One paragraph, not a wall of text.

3. **Basic example** — Show the simplest working version. Full, runnable code. No `// ...` elisions in the first example.

4. **Detailed sections** — Break down the API surface, configuration options, or patterns. Each section has a heading, a brief explanation, and a code example.

5. **Advanced usage** (if applicable) — Composition with other features, customization, edge cases. This section can assume the reader understood the basics above.

6. **Related pages** — Link to related docs pages at the bottom. Use Docusaurus-style relative links: `[Sequencer DSL](../sequencers/dsl.md)`.

#### Writing Style Rules

The standard is [`docs/contributing/user-docs.md`](../../../docs/contributing/user-docs.md) — the
outsider rule, the two sentence tests, the tells table, and the voice. Read it and apply it; it is
not restated here, so there is one copy to keep current.

The part most relevant to a new page: **write from the outside.** Describe what the thing does when
you call it, never how it was built, what it used to do, or what prompted it. If a sentence would
only make sense to someone who worked on the implementation, cut it.

#### Code Examples

- Use TypeScript with proper imports
- Show complete, runnable snippets (not fragments)
- Use realistic names and data (not `foo`, `bar`, `myThing`)
- Match the coding conventions from `AGENTS.md`:
  - Trust the type system — don't re-validate typed inputs
  - No wrapper functions for simple property access
  - Schemas belong with their blocks

### Step 4: Add to Sidebar

The sidebar is **manually configured**, not auto-generated. Every new page must be added to the appropriate sidebar file or it will not appear in navigation.

**For docs pages** (`apps/docs/docs/`):

1. Open `apps/docs/sidebars.ts`
2. Find the category where your page belongs
3. Add the page path (relative to `docs/`, without the `.md` extension) to that category's `items` array

Example: adding a new page `docs/tools/mcp.md` to the Tools category:

```ts
{
  type: "category",
  label: "Tools",
  items: [
    "tools/overview",
    "tools/fetch",
    "tools/crawl",
    "tools/bash",
    "tools/mcp",       // <-- new page
  ],
},
```

**For guide pages** (`apps/docs/guides/`):

1. Open `apps/docs/sidebarsGuides.ts`
2. Add the page path to the `guidesSidebar` array (top-level or inside a category like `"Deployment"`)

Example: adding a new deployment guide:

```ts
{
  type: "category",
  label: "Deployment",
  items: [
    "deployment",
    "deploying-to-vercel",
    "deploying-to-railway",
    "deploying-with-docker",
    "deploying-to-fly",   // <-- new page
  ],
},
```

**Creating a new section** in the docs sidebar:

1. Create the directory under `apps/docs/docs/`
2. Add a new category object in `sidebars.ts` at the appropriate position:

```ts
{
  type: "category",
  label: "New Section",
  items: [
    "new-section/overview",
  ],
},
```

### Step 5: Cross-link

Check if existing pages should link to the new page:
- Search docs for mentions of the topic that could benefit from a link
- Update the "Related" or "See also" sections of related pages

### Step 6: Verify

Start the docs site and check the page renders correctly:

```bash
cd apps/docs && npx docusaurus start --port 3000
```

Verify:
- Page appears in the sidebar at the correct position
- All code blocks have syntax highlighting
- All links resolve (no broken cross-references)
- Content reads well and follows the writing style

## Guidelines

- **One concept per page.** Don't combine "how to create a store adapter" with "how store adapters work internally." Split into a guide and a reference if needed.
- **Code first, explanation second.** Show what the API looks like, then explain why. Engineers read code faster than prose.
- **Don't document internals.** These docs are for framework users. Internal implementation details belong in `docs/architecture/`, not in `apps/docs/`.
- **Keep examples realistic.** Use domain-appropriate names. "email-validator" not "my-handler". "research-planner" not "test-sequencer".
- **Don't duplicate CLAUDE.md or AGENTS.md.** Those are for agents building the framework. `apps/docs/` is for developers using it.
