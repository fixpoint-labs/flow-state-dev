---
name: fsd:add-docs-page
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

The docs site has this structure:

```
apps/docs/docs/
  getting-started/      # Onboarding, installation, first flow
  fundamentals/         # Core concepts (blocks, flows, state, actions)
  sequencers/           # Sequencer DSL, composition
  server/               # Server setup, routes, middleware
  streaming/            # SSE, item model, resume
  client/               # Client API, sessions
  api/                  # React hooks, components
  resources/            # Resources, client data
  persistence/          # Store adapters, data model
  tools/                # Utility blocks, tool library
  patterns/             # Composable patterns
  testing/              # Test harness, mocking
  cli/                  # CLI reference
  devtool/              # DevTool usage
```

If unsure which section, read the existing pages in candidate sections to find the best fit.

### Step 2: Read Reference Pages

Read 1-2 existing pages from the target section to understand:
- Frontmatter conventions (title, sidebar_position, description)
- Content structure and depth
- Code example style
- How concepts are introduced

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

#### Writing Style Rules (from CLAUDE.md)

- **Audience is engineers.** No marketing speak.
- **Short sentences. Varied rhythm.**
- **Minimal em-dashes.** Prefer commas, periods, or restructured sentences.
- **No AI cadence.** Avoid: "X isn't just Y — it's Z", escalating lists of three.
- **Introduce concepts for newcomers.** When first mentioning something, briefly say what it does.
- **Be direct about tradeoffs.** "This works for demos, not for production."
- **Conclusions earn their place.** Don't end every section with a triumphant one-liner.

#### Code Examples

- Use TypeScript with proper imports
- Show complete, runnable snippets (not fragments)
- Use realistic names and data (not `foo`, `bar`, `myThing`)
- Match the coding conventions from `AGENTS.md`:
  - Trust the type system — don't re-validate typed inputs
  - No wrapper functions for simple property access
  - Schemas belong with their blocks

### Step 4: Add to Sidebar (if needed)

Docusaurus auto-generates the sidebar from the directory structure and `sidebar_position` frontmatter. If the page is in an existing section, just set the right `sidebar_position`.

If you're creating a new section:
1. Create the directory under `apps/docs/docs/`
2. Add a `_category_.json` file:
   ```json
   {
     "label": "Section Name",
     "position": <number>,
     "link": {
       "type": "generated-index",
       "description": "One sentence describing this section."
     }
   }
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
