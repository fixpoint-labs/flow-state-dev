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

## How a bundle works

```ts
type GenerativeComponent<TSchema extends ZodTypeAny> = {
  name: string;                                          // 'info-card'
  schema: TSchema;                                       // shared by tool + renderer
  Renderer: ComponentType<{ item: ComponentItem }>;      // React renderer
  tool: (options?) => BlockDefinition;                   // handler block factory
};
```

When the LLM calls the tool, the handler runs `ctx.emitComponent(name, data, { key })`. The emitted `component` item flows through the stream and lands in `FlowProvider`'s renderer registry, which dispatches it to the matching `Renderer` by name.

Every `emit*` handler is a normal block, which means a tool can be a sequencer: fetch data, validate, then emit. A tool can also kick off a `.work()` sidechain that re-emits the same component with the same `key` once enrichment lands — the user sees the card appear, then upgrade in place.

## Three-line setup

Server side, in your generator definition:

```ts
import { generativeUI } from "@flow-state-dev/ui/generative";

const tripGenerator = generator({
  name: "trip-concierge",
  itemVisibility: { client: true, history: true },
  prompt: TRIP_CONCIERGE_PROMPT,
  tools: [...generativeUI.tools(), webSearch],
});
```

Client side, on `FlowProvider`:

```tsx
import { generativeUI } from "@flow-state-dev/ui/generative";

<FlowProvider
  flowKind="trip-concierge"
  userId={userId}
  renderers={{ component: generativeUI.renderers() }}
>
  <ChatUI />
</FlowProvider>
```

That's the whole integration. The schema, tool, and renderer are linked through the shared `name`.

## Picking a tighter palette

Fewer tools generally means better selection accuracy on smaller models. Use `pick` to scope a subset:

```ts
const subset = generativeUI.pick("info-card", "link-card");

// In the generator:
tools: [...subset.tools(), webSearch];

// On FlowProvider:
renderers: { component: subset.renderers() };
```

`pick` returns the same `.tools()` / `.renderers()` surface scoped to the chosen names. Unknown names are silently ignored.

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

`generativeUI.renderers()` returns the lightweight defaults built into the runtime package. They use plain Tailwind classes and have no shadcn-primitive dependency, so they work anywhere Tailwind is available.

For a polished, fully-customizable variant, install the renderer through the registry and override the entry on `FlowProvider`:

```bash
fsdev ui add info-card
```

```tsx
import { generativeUI } from "@flow-state-dev/ui/generative";
import { InfoCardRenderer } from "@/components/flow-state/generative/info-card";

<FlowProvider
  renderers={{
    component: {
      ...generativeUI.renderers(),
      "info-card": InfoCardRenderer,
    },
  }}
>
```

The runtime renderers are good defaults; the registry-distributed renderers are yours to edit.

## Authoring guidance

A few notes for when you build your own bundles or extend the pack.

- **Single-source the schema.** The Zod object that backs the renderer's `data` contract is the same object passed to `inputSchema`. Don't split them, and don't transform the data on the way out of the handler — the renderer should accept exactly what the LLM produced.
- **Choose a stable `key`.** `ctx.emitComponent` accepts a `key`; clients show only the latest item with a given key. Pick a key that reflects the *identity* of the thing being rendered — `id` for an info card, `url` for a link card. This is how `.work()` sidechain re-emission works without leaving stale cards behind.
- **Short, distinct tool descriptions.** The description is the LLM's design-system documentation. Use the `USE FOR / DO NOT USE FOR` template and redirect to neighboring shapes by name. Test descriptions empirically — small wording changes meaningfully shift selection accuracy.
- **Schema descriptions land in the prompt.** Zod `.describe()` strings flow into the LLM-facing tool schema. Audit them for accidental instruction-style language that could be hijacked by a malicious user input.
