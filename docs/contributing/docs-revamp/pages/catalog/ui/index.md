---
title: UI
type: catalog
description: Components for chat and agent screens, copied into your project so you own them.
---

# UI

`@flow-state-dev/ui` is a component library for chat, agent and generative-UI screens, distributed through a [shadcn-compatible custom registry](https://ui.shadcn.com/docs/registry). Components are copied into your project, so you own and edit them like any other source file.

## How distribution works

Components are not runtime imports. When you add one, the registry copies a self-contained `.tsx` file into `components/flow-state/` in your project, along with the other registry items it needs. From then on it is your source code: restyle it, fork it, or replace pieces freely. There is no `import { Message } from "@flow-state-dev/ui"`.

Install with `pnpm fsdev ui add message`, and see what is available with `pnpm fsdev ui list`. The [Reference](../../reference/ui-components.md) has the install commands, including the direct shadcn URL.

Upgrades are not automatic. When a new version of a component is released, re-add it, then replay your local edits.

## Colours and theming

Registry components never name a colour directly. They use tokens, CSS variables with names that say what the colour is for: `background`, `foreground`, `muted-foreground`, `destructive` and so on. Change a token in your stylesheet and every component that reads it follows, with no edit to the files you copied in.

Status has its own tokens: `success`, `warning`, `info`, `attention` and `destructive`. `warning` and `attention` are separate so an app can make "waiting on you" stand out without every warning looking like a request. The first component you add that uses one also adds the `tokens` item, which writes defaults for all of them, light and dark, into your stylesheet. To restyle, set the tokens you want under `:root` and `.dark`; your values win over the defaults.

Token names, what each is for, the default values and the override rule are in the [Reference](../../reference/ui-components.md).

## What's in the box

Components fall into groups by how much they depend on Flow State.

### Common components

Generic chat and content building blocks: `Conversation`, `Message`, `PromptInput`, `CodeBlock`, `Reasoning`, `Tool`. Most take plain props, or one item to draw, and need no provider. Use them anywhere, including outside a flow.

See [Common components](./common-components) for the full list.

### Flow-aware components

Components that consume `@flow-state-dev/core` item types directly. Some read the session's items through a provider, some read `FlowProvider`'s renderer map, and some call `@flow-state-dev/react` hooks, so most of them only make sense inside a flow.

Examples: `RequestGroup`, `TaskPlan`, `Approval`, `Sandbox`, `JSXPreview`. The `chat-assistant` item installs `chatAssistantRenderers`, a ready-made map from every standard item type to one of these components.

See [Flow-aware components](./flow-aware-components).

### Generative UI

Each generative shape is a Zod schema, a React renderer and an `emit*` tool block. Give the tool to a generator and the renderer to `FlowProvider`, and a generator can pick a card per turn: both use the same name and schema. This is the one part of the package you import at runtime.

See [Generative UI](./generative).

## Using them with a flow

Flow-aware components take Flow State item types as props. Pass `chatAssistantRenderers` to `FlowProvider` and the default components draw each item type:

```tsx title="src/app/chat/chat.tsx"
"use client";

import { FlowProvider, ItemsRenderer, useSession } from "@flow-state-dev/react";
import { chatAssistantRenderers } from "@/components/flow-state/chat-assistant";
import { Conversation, ConversationContent } from "@/components/flow-state/conversation";
import { SourcesGroup } from "@/components/flow-state/sources";

function Items({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId, { items: true });
  return (
    <Conversation>
      <ConversationContent>
        <ItemsRenderer items={session.items} />
        <SourcesGroup items={session.items} />
      </ConversationContent>
    </Conversation>
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

`chatAssistantRenderers` does not draw sources, so `SourcesGroup` sits beside it. To override or silence one entry, spread the existing map first so the other entries stay. The map's contents and the override rule are in the [Reference](../../reference/ui-components.md).
