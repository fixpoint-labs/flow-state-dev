---
sidebar_position: 4
---

# Generative UI

A starter pack of LLM-emitted UI shapes. Each shape ships as a bundle of three things that travel together:

- a Zod schema describing the data,
- a React renderer that consumes that data,
- an `emit*` tool block that the LLM calls to render it.

The same schema serves as the tool's `inputSchema` and the renderer's data contract. Generators load the tools so the model can pick a shape per turn; `FlowProvider` loads the renderers so the emitted items show up inline.

This is non-deterministic component emission. Today components are usually emitted by deterministic pattern code. With this pack, the *generator* picks the rendering shape based on what it's saying.

## Two entrypoints: tools and renderers

The pack has two import paths, one per surface:

- **`@flow-state-dev/ui/generative/tools`** — the *tool surface*. This runs server-side. It carries the Zod schemas and the `emit*` tool blocks, which are real `handler` blocks built on `@flow-state-dev/core`.
- **`@flow-state-dev/ui/generative/renderers`** — the *renderer surface*. This runs in the browser. It carries only the React renderers.

The split exists for one reason: the renderer surface stays browser-light. A renderer only needs the emitted data's *type*, which is erased at build time, so importing the renderers never pulls the authoring runtime (or Zod) into your browser bundle. The tool factories, which do reach `@flow-state-dev/core`, stay on the server side where that weight belongs. (A guard test enforces that the renderer surface never value-imports `core` or Zod.)

```ts
// tool surface (server): name + schema + handler-block factory
import { generativeTools } from "@flow-state-dev/ui/generative/tools";

// renderer surface (browser): name + React renderer only
import { generativeRenderers } from "@flow-state-dev/ui/generative/renderers";
```

When the LLM calls the tool, the handler runs `ctx.emit.component(name, data, { key })`. The emitted `component` item flows through the stream and lands in `FlowProvider`'s renderer registry, which dispatches it to the matching renderer by name. The shared `name` is what links the two surfaces.

> **Migration.** This replaces the earlier single import `@flow-state-dev/ui/generative`, which exported one `generativeUI` object. `generativeUI.tools()` becomes `generativeTools()` (from `.../generative/tools`); `generativeUI.renderers()` becomes `generativeRenderers()` (from `.../generative/renderers`).

Every `emit*` handler is a normal block, which means a tool can be a sequencer: fetch data, validate, then emit. A tool can also kick off a `.work()` sidechain that re-emits the same component with the same `key` once enrichment lands — the user sees the card appear, then upgrade in place.

## Setup

Server side, in your generator definition:

```ts
import { generativeTools } from "@flow-state-dev/ui/generative/tools";

const tripGenerator = generator({
  name: "trip-concierge",
  itemVisibility: { client: true, history: true },
  prompt: TRIP_CONCIERGE_PROMPT,
  tools: [...generativeTools(), webSearch],
});
```

Client side, on `FlowProvider`:

```tsx
import { generativeRenderers } from "@flow-state-dev/ui/generative/renderers";

<FlowProvider
  flowKind="trip-concierge"
  userId={userId}
  renderers={{ component: generativeRenderers() }}
>
  <ChatUI />
</FlowProvider>
```

That's the whole integration. The schema, tool, and renderer are linked through the shared `name`.

## Picking a tighter palette

Fewer tools generally means better selection accuracy on smaller models. Each entrypoint has a matching `.pick(...names)`:

```ts
// In the generator (server):
tools: [...generativeTools.pick("info-card", "link-card"), webSearch];

// On FlowProvider (browser):
renderers: { component: generativeRenderers.pick("info-card", "link-card") };
```

`pick` returns the same registry / block array scoped to the chosen names. Unknown names are silently ignored. Keep the picked names in sync across the two surfaces so every emitted shape has a renderer.

## Starter pack

Phase 1 ships two shapes. More are on the way.

| Tool | Component | Use for |
| -- | -- | -- |
| `emitInfoCard` | `info-card` | Profile snapshots, place summaries, contact-style info |
| `emitLinkCard` | `link-card` | Citations, source attributions, replacing bare URLs |

Each tool description follows a consistent template so the LLM can discriminate between neighboring shapes:

```
<one-line shape summary>
USE FOR: <2–4 concrete examples>
DO NOT USE FOR: <2–3 cases that would fool a naive picker, with redirect to the correct tool>
```

### Info card

Renders a structured information card with a title, optional image, and up to 8 fact rows.

Schema fields: `id`, `title`, `subtitle?`, `imageUrl?`, `facts: [{ label, value }]` (max 8), `footer?`. The default tool keys cards by `id` so re-emissions replace prior versions in place.

### Link card

Rich preview for an external URL — title, optional description, source name, optional preview image and favicon.

Schema fields: `url`, `title`, `description?`, `siteName?`, `imageUrl?`, `favicon?`. The default tool keys cards by `url` so the same link collapses to a single card across re-emissions.

## Project-owned renderers

`generativeRenderers()` returns the lightweight defaults built into the runtime package. They use plain Tailwind classes and have no shadcn-primitive dependency, so they work anywhere Tailwind is available.

For a polished, fully-customizable variant, install the renderer through the registry and override the entry on `FlowProvider`:

```bash
fsdev ui add info-card
```

```tsx
import { generativeRenderers } from "@flow-state-dev/ui/generative/renderers";
import { InfoCardRenderer } from "@/components/flow-state/generative/info-card";

<FlowProvider
  renderers={{
    component: {
      ...generativeRenderers(),
      "info-card": InfoCardRenderer,
    },
  }}
>
```

The runtime renderers are good defaults; the registry-distributed renderers are yours to edit.

## Authoring guidance

A few notes for when you build your own bundles or extend the pack.

- **Single-source the schema.** The Zod object that backs the renderer's `data` contract is the same object passed to `inputSchema`. Don't split them, and don't transform the data on the way out of the handler — the renderer should accept exactly what the LLM produced.
- **Choose a stable `key`.** `ctx.emit.component` accepts a `key`; clients show only the latest item with a given key. Pick a key that reflects the *identity* of the thing being rendered — `id` for an info card, `url` for a link card. This is how `.work()` sidechain re-emission works without leaving stale cards behind.
- **Short, distinct tool descriptions.** The description is the LLM's design-system documentation. Use the `USE FOR / DO NOT USE FOR` template and redirect to neighboring shapes by name. Test descriptions empirically — small wording changes meaningfully shift selection accuracy.
- **Schema descriptions land in the prompt.** Zod `.describe()` strings flow into the LLM-facing tool schema. Audit them for accidental instruction-style language that could be hijacked by a malicious user input.
