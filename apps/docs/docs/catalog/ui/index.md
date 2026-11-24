---
title: UI
type: catalog
description: Components for chat and agent screens, copied into your project so you own them.
---

# UI

`@flow-state-dev/ui` is a component library for chat, agent and generative-UI screens, distributed through a [shadcn-compatible custom registry](https://ui.shadcn.com/docs/registry). Components are copied into your project, so you own and edit them like any other source file.

## How distribution works

Components are not runtime imports, apart from the generative UI shapes below. When you add one, the registry copies a self-contained `.tsx` file into `components/flow-state/` in your project, along with the other registry items it needs. From then on it is your source code: restyle it, fork it, or replace pieces freely. There is no `import { Message } from "@flow-state-dev/ui"`.

Install with `pnpm fsdev ui add message`, and see what is available with `pnpm fsdev ui list`. The [Reference](../../reference/ui-components.md) has the install commands, including the direct shadcn URL.

Upgrades are not automatic. When a new version of a component is released, re-add it, then replay your local edits.

## Colours and theming

Registry components never name a colour directly. They use tokens, CSS variables with names that say what the colour is for: `background`, `foreground`, `muted-foreground`, `destructive` and so on. Change a token in your stylesheet and every component that reads it follows, with no edit to the files you copied in.

Status has its own tokens: `success`, `warning`, `info`, `attention` and `destructive`. Use `attention` for something waiting on the user, and `warning` for everything else. The first component you add that uses one also adds the `tokens` registry item, which writes defaults for all of them, light and dark, into your stylesheet. To restyle, set the tokens you want under `:root` and `.dark`; your values win over the defaults.

Token names, what each is for, the default values and the override rule are in the [Reference](../../reference/ui-components.md).

## What's in the box

Components fall into groups by how much they depend on Flow State.

### Common components

Generic chat and content components: `Conversation`, `Message`, `PromptInput`, `CodeBlock`, `Reasoning`, `Tool`. Most take plain props, or one item (a single message, tool call or other entry in a session) to draw, and need no provider. Use them anywhere, including outside a flow.

See [Common components](../../reference/ui-components.md) for the full list.

### Flow-aware components

Components that consume `@flow-state-dev/core` item types directly. Most read from `FlowProvider`, the React provider from `@flow-state-dev/react` that connects its children to one flow, or from that package's hooks, so render them under a `FlowProvider`.

Examples: `RequestGroup`, `TaskPlan`, `Approval`, `Sandbox`, `JSXPreview`. The `chat-assistant` registry item installs `chatAssistantRenderers`, a ready-made map from the standard item types to components like these.

See [Flow-aware components](../../reference/ui-components.md).

### Generative UI

Generative UI lets the model choose a card to show, such as a link card or an info card, instead of replying in plain text. A generator is the block that calls the model. Each card, called a shape, comes as three parts: a Zod schema describing its data, an `emit*` tool block the model calls to pick it, and a React renderer that draws it. Give the tool to a generator and the renderer to `FlowProvider`. A shape's tool and renderer share a name, so the card the model picks is the one that draws. This is the one part of the package you import at runtime.

See [Generative UI](./generative.md).

## Using them with a flow

Pass `chatAssistantRenderers` to `FlowProvider` and the default components draw each item type:

```tsx title="src/app/chat/chat.tsx"
"use client";

import { FlowProvider, ItemsRenderer, useSession } from "@flow-state-dev/react";
import { chatAssistantRenderers } from "@/components/flow-state/chat-assistant";
import { Conversation, ConversationContent } from "@/components/flow-state/conversation";
import { SessionItemsProvider } from "@/components/flow-state/session-items-context";
import { SourcesGroup } from "@/components/flow-state/sources";

function Items({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId, { items: true });
  return (
    <SessionItemsProvider value={session.items}>
      <Conversation>
        <ConversationContent>
          <ItemsRenderer items={session.items} />
          <SourcesGroup items={session.items} />
        </ConversationContent>
      </Conversation>
    </SessionItemsProvider>
  );
}

export function Chat({ userId, sessionId }: { userId: string; sessionId: string }) {
  return (
    <FlowProvider flowKind="my-flow" userId={userId} renderers={chatAssistantRenderers}>
      <Items sessionId={sessionId} />
    </FlowProvider>
  );
}
```

`SessionItemsProvider` hands the whole session to components that look past their own item. A task board reads its task changes from it, and an approval finds the answer that resolved it, so after a reload it shows as answered. Without the provider they see an empty list.

`chatAssistantRenderers` does not draw sources, the URL references a model's built-in tools, such as web search, return, so `SourcesGroup` sits beside it.

The map is yours to change, and `false` means "don't draw this". Replacing a keyed group such as `data` outright drops its other entries, so spread the existing group first:

```ts title="src/app/chat/renderers.ts"
import type { RendererRegistry } from "@flow-state-dev/react";
import { chatAssistantRenderers } from "@/components/flow-state/chat-assistant";

// Every default renderer except the task-board card.
export const renderers: RendererRegistry = {
  ...chatAssistantRenderers,
  data: { ...chatAssistantRenderers.data, "task-board-meta": false },
};
```

Writing `data: { "task-board-meta": false }` alone would also drop the audit annotations.

Not every component needs the wiring. One that takes a typed item as a prop, such as `<ModelBadge model={item.model} />`, renders anywhere. `Approval`, `TaskPlan` and the other components that look at the rest of the session need the `SessionItemsProvider` shown above. The map's contents and the override rule are in the [Reference](../../reference/ui-components.md).
