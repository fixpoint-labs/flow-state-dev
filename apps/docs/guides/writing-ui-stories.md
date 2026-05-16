---
id: writing-ui-stories
title: Writing UI stories
description: How to add and run Storybook stories for components in @flow-state-dev/ui.
---

# Writing UI stories

Components in `@flow-state-dev/ui` ship with Storybook stories. A story is a file that exports one or more example uses of a component, and Storybook is a small dev server that renders each one in isolation. The hosted build lives at [storybook.flow-state.dev](https://storybook.flow-state.dev) and gets a preview URL on every PR that touches `packages/ui`.

If you're new to the registry itself, start with the [UI overview](/docs/ui/overview).

## Where stories live

Stories sit next to the component they cover:

```
packages/ui/registry/components/message.tsx
packages/ui/registry/components/message.stories.tsx
```

The Storybook glob picks them up by filename (`*.stories.tsx`). The registry build only copies files that are explicitly listed in `registry.json`, so stories never leak into the published registry.

## Running Storybook locally

```bash
pnpm --filter @flow-state-dev/ui storybook
```

That starts the dev server on `http://localhost:6006`. To run the same build CI runs:

```bash
pnpm --filter @flow-state-dev/ui storybook:build
```

The CI job runs `storybook:build` on every PR, so a broken story fails the check before it reaches the deploy step.

## Anatomy of a story

Stories use Storybook's [Component Story Format 3](https://storybook.js.org/docs/writing-stories). Each file has a default export with metadata and named exports for each variant.

```tsx
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Message } from "./message";
import { messageItem } from "../../stories/fixtures/items";

const meta = {
  title: "Components/Message",
  component: Message,
} satisfies Meta<typeof Message>;

export default meta;
type Story = StoryObj<typeof meta>;

export const User: Story = {
  args: { item: messageItem({ role: "user", text: "Hi" }) },
};

export const Assistant: Story = {
  args: { item: messageItem({ role: "assistant", text: "Hello." }) },
};
```

The `title` decides the sidebar position in Storybook. Use `Components/<Name>` so everything lands under one folder.

## Using fixtures

Most components accept Flow State item types directly. `packages/ui/stories/fixtures/` has typed factories for the common shapes:

- `messageItem`, `reasoningItem`, `toolItem`, `componentItem`, `sourceItem` — single items.
- `plainConversation`, `toolUseConversation` — multi-item sessions.
- `makeTask`, `makeTaskChange`, `makeBoardMeta` — task-board state for `<TaskPlan />`.

Compose those instead of hand-rolling item shapes in each story. If your component needs a shape the fixtures don't cover, add a factory there rather than inlining one.

## When you need FlowProvider

Components that read `useFlowContext().renderers` (currently `RequestGroup` and `ChatAssistant`) need a `FlowProvider` in the tree. The global `preview.tsx` already wraps every story in `<FlowProvider renderers={chatAssistantRenderers}>`, so most of the time you don't need to think about it. Override it per-story by wrapping with your own `FlowProvider` if you want a different renderer registry.

`<TaskPlan />` reads from `<SessionItemsProvider />` rather than `FlowProvider`. Wrap it manually in the story when you want to drive it from a fixture session — see `task-plan.stories.tsx` for the pattern.

## Common variants worth writing

There's no fixed rule, but these are the ones reviewers look for:

- **Default** — the most common rendering path.
- **Streaming / in-progress** — for components that show a status state.
- **Error** — if the component renders an error case.
- **Empty** — for containers that have a zero-state.

Two or three named exports per component is typical.

## Verifying before commit

`pnpm --filter @flow-state-dev/ui storybook:build` is the same check CI runs. If it passes locally, the smoke job will pass on the PR. Visual review happens on the per-PR preview URL Vercel posts as a check.

## Further reading

- [UI overview](/docs/ui/overview) — what the registry is and how it's distributed.
- [Storybook CSF 3 reference](https://storybook.js.org/docs/writing-stories) — full story format spec.
