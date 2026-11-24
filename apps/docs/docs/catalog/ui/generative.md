---
title: Generative UI
type: catalog
description: "Let the model answer with a component: a tool that emits the shape and a renderer that draws it."
---

# Generative UI

Sometimes a paragraph is the wrong answer. A user asks about a restaurant and wants a card with the address, the hours and a photo. Generative UI lets the model make that call: it decides, turn by turn, whether to answer with a card instead of plain text.

`@flow-state-dev/ui` ships a generative pack of ready-made shapes. Each one is a Zod schema, a React renderer and an `emit*` tool block. The same schema is the tool's `inputSchema` and the renderer's data contract. A generator (the block that calls the model) gets the tools, so it can pick a shape. `FlowProvider` (the React provider that draws a flow's stream) gets the renderers, so the emitted card shows up inline.

## Tools and renderers

Import each half from its own path:

- `@flow-state-dev/ui/generative/tools` runs on the server. It holds the Zod schemas and the `emit*` tool blocks, which are `handler` blocks built on `@flow-state-dev/core`.
- `@flow-state-dev/ui/generative/renderers` runs in the browser. It holds only the React renderers.

Importing the renderers adds no Zod or `@flow-state-dev/core` code to your browser bundle.

The two halves are linked by one string, the shape's name. When the model calls `emitInfoCard`, the tool emits a data item, a structured record on the stream, whose `dataType` is `info-card`. `FlowProvider` draws it with the renderer registered under `info-card` in its `data` map. A data item with no renderer draws nothing.

The pack has two shapes:

| Tool | Shape | Use for |
| -- | -- | -- |
| `emitInfoCard` | `info-card` | Profile snapshots, place summaries, contact-style info |
| `emitLinkCard` | `link-card` | Citations, source attributions, replacing bare URLs |

The schema fields, tool descriptions and the exact shape of the emitted item are in the [Reference](../../reference/ui-components.md).

## Set it up

On the server, spread the pack's tools into a generator:

```ts title="src/flows/trip-concierge/blocks/concierge.ts"
import { generator } from "@flow-state-dev/core";
import { generativeTools } from "@flow-state-dev/ui/generative/tools";
import { z } from "zod";

export const concierge = generator({
  name: "concierge",
  model: "openai/gpt-6-luna",
  itemVisibility: { client: true, history: true },
  prompt: "You plan trips. Answer with a card when the user asks about a place or a source.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
  tools: generativeTools(),
});
```

In the browser, hand the renderers to `FlowProvider`:

```tsx title="src/app/trip/trip-provider.tsx"
"use client";

import type { ReactNode } from "react";
import { FlowProvider } from "@flow-state-dev/react";
import { generativeRenderers } from "@flow-state-dev/ui/generative/renderers";

export function TripProvider({ userId, children }: { userId: string; children: ReactNode }) {
  return (
    <FlowProvider
      flowKind="trip-concierge"
      userId={userId}
      renderers={{ data: generativeRenderers() }}
    >
      {children}
    </FlowProvider>
  );
}
```

## Pick a tighter set

Fewer tools generally means better selection on smaller models. Both entrypoints have a `.pick(...names)` that takes shape names:

```ts title="src/flows/trip-concierge/pack.ts"
import { generativeTools } from "@flow-state-dev/ui/generative/tools";
import { generativeRenderers } from "@flow-state-dev/ui/generative/renderers";

export const packTools = generativeTools.pick("link-card");
export const packRenderers = generativeRenderers.pick("link-card");
```

The two sides are picked separately, so keep the names in sync. A shape you picked on the tool side with no renderer draws nothing. Unknown names are silently ignored.

## Update a card in place

Your own emit tool can be a sequencer that fetches data, validates it and then emits. It can also start a side chain (`.sideChain()`, a step that runs alongside without blocking the reply) that re-emits the same card once the slower lookup (photos, hours) returns. The user sees the card appear, then update in place.

That works because each emit carries a `key`. Within one request, the page shows only the latest item for a key. The pack keys an info card by `id` and a link card by `url`. Across requests, the same `id` or `url` makes a separate card. Items with no key are always shown.

A second call with the same key replaces the first: the client shows the latest card, and the stored record keeps one entry per request and key, with the newest data. Nothing is merged, so the second call must carry every field you want to keep. If the model calls `emitInfoCard` twice with the same `id`, the user ends up with one card.

To key some other way, pass `keyFrom` to the tool factory:

```ts title="src/flows/trip-concierge/pack.ts"
import { emitInfoCardTool } from "@flow-state-dev/ui/generative/tools";

export const cardByTitle = emitInfoCardTool({ keyFrom: (input) => `card:${input.title}` });
```

## Bad input fails the call

The tool validates the model's input against the shape's schema before it emits. An info card takes at most 8 facts. If the model sends eleven, the tool run throws and no card is emitted. Nothing is drawn.

## Use your own renderer

`generativeRenderers()` returns lightweight defaults from `@flow-state-dev/ui`. They use plain Tailwind classes, so they work anywhere Tailwind is available. To own the markup, copy a renderer into your app:

```bash
pnpm fsdev ui add info-card
```

Then override its entry. Spread the defaults and replace the name you want:

```tsx title="src/app/trip/trip-provider.tsx"
"use client";

import type { ReactNode } from "react";
import { FlowProvider } from "@flow-state-dev/react";
import { generativeRenderers } from "@flow-state-dev/ui/generative/renderers";
import { InfoCardRenderer } from "@/components/flow-state/generative/info-card";

export function TripProvider({ userId, children }: { userId: string; children: ReactNode }) {
  return (
    <FlowProvider
      flowKind="trip-concierge"
      userId={userId}
      renderers={{
        data: { ...generativeRenderers(), "info-card": InfoCardRenderer },
      }}
    >
      {children}
    </FlowProvider>
  );
}
```

`fsdev ui add info-card` writes `components/flow-state/generative/info-card.tsx`, which exports `InfoCardRenderer`. The copied file is yours to edit. Upgrades to it are not automatic.

## Build your own shape

A custom shape is a `handler` block whose `inputSchema` is a Zod object and whose `execute` calls `ctx.emit.data(name, input, { key })`. Add it to a generator's `tools`, and register a renderer under the same `name` in the `data` map. The renderer receives the item, and the data is on `item.value`.

- **One schema.** Pass the same Zod object to `inputSchema` and to the renderer's data type. Do not transform the data on the way out of the handler.
- **A stable `key`.** Pick one that reflects the identity of the thing drawn: `id` for a card about a record, `url` for a link.
- **Short, distinct tool descriptions.** The description is what the model reads to choose. Say what the shape is for and what it is not for, and name the neighbouring tool to use instead. Small wording changes shift which tool the model picks, so test them.
- **Field descriptions are prompts.** `.describe()` text on a schema field goes into the model-facing tool schema, so write it as an instruction to the model, not as a note to developers.

## Next

- [UI](./index.md): the rest of the component package and how the registry works.
- [Reference](../../reference/ui-components.md): schemas, `pick`, tool descriptions and the emitted item.
