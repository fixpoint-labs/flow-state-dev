---
sidebar_position: 1
---

# Overview

`@flow-state-dev/ui` — A first-party component library for chat, agent, and generative-UI patterns, distributed via a [shadcn-compatible custom registry](https://ui.shadcn.com/docs/registry). Components are copied into your project, so you own and edit them like any other source file.

## How distribution works

Components ship through a registry, not as runtime imports. When you add a component, the registry copies a self-contained `.tsx` file into `components/flow-state/` in your project. From that point on it is your source code — restyle it, fork it, or replace pieces freely. There is no `import { Message } from "@flow-state-dev/ui"` to worry about.

The trade-off: upgrades are not automatic. When the canonical source changes, you re-add the component to pick up the new version, then replay your local edits.

```bash
# Via the fsdev CLI (recommended)
fsdev ui add message
fsdev ui add conversation prompt-input

# Or via shadcn directly
npx shadcn@latest add https://ui.flow-state.dev/r/message.json

# List what's available
fsdev ui list
```

## Colours and theming

Registry components never name a colour directly. They use tokens, CSS variables with names that say what the colour is for: `background`, `foreground`, `muted-foreground`, `destructive` and so on. Change a token in your stylesheet and every component that reads it follows, with no edit to the files you copied in.

Status gets its own tokens:

| Token | Used for |
|---|---|
| `success` | done, approved, a passing result |
| `warning` | something is off but nobody is being asked: a blocked task, a stuck request |
| `info` | running, in progress, informational |
| `attention` | a person must act: a tool call waiting for approval, a task parked for review |
| `destructive` | failed, rejected, an error |

Each has a `-foreground` partner for text on a filled background. `warning` and `attention` are separate tokens, so an app can make "waiting on you" stand out without every warning looking like a request.

Defaults come with the components. The first `fsdev ui add` of a component that uses a status token also adds the `tokens` item, which writes every token, light and dark, into your stylesheet. The defaults are plain: green, amber, blue, yellow and red.

```bash
fsdev ui add tool task-plan   # also adds tokens
```

The defaults sit in a base layer, so your own values win wherever you declare them. To restyle, set the tokens you want to change:

```css
:root {
  --attention: <your highlight colour>;
  --attention-foreground: <text on it>;
  --warning: <your warning colour>;
}
.dark {
  --attention: <your highlight colour, dark>;
}
```

**Upgrading copies from before the status tokens existed.** Re-add the components you use, then run `fsdev ui add tokens` once. A component copied in fresh against a stylesheet without the tokens renders its status parts with no colour, not an error.

## What's in the box

Three categories, separated by how tightly they couple to Flow State.

### Common components

Generic chat and content primitives. They take primitive props (`role`, `content`, `isStreaming`) and have no runtime dependency on `@flow-state-dev/*`. Use them anywhere — even outside a flow.

Examples: `Message`, `Conversation`, `PromptInput`, `CodeBlock`, `Reasoning`, `Tool`.

See [Common components](./common-components) for the full list.

### Flow-aware components

Components that consume `@flow-state-dev/core` item types directly — no adapter layer. They subscribe to session item streams, render typed `OutputItem` shapes, or wire into the renderer registry on `FlowProvider`. Most of them only make sense inside a flow.

Examples: `ChatAssistant` (the bundled renderer registry), `RequestGroup`, `TaskPlan`, `Artifact`, `Sandbox`, `JSXPreview`.

See [Flow-aware components](./flow-aware-components).

### Generative UI

A separate runtime-importable surface at `@flow-state-dev/ui/generative`. Each generative shape ships as a bundle of (Zod schema, React renderer, `emit*` tool block) so a generator can pick a rendering shape per turn and the data contract stays single-sourced across both surfaces.

This is the one part of the package you import at runtime. The renderers are still installable through the registry for project-owned variants.

See [Generative UI](./generative).

## Framework integration

The flow-aware components accept Flow State item types as props directly — no mapping step. That's the difference between a `Message` you can drop into any React app (primitive props) and the framework rendering pipeline (`OutputItem`-shaped props).

The `chat-assistant` component bundles a pre-wired renderer registry that maps every standard item type to its default component:

```tsx
import { chatAssistantRenderers } from "@/components/flow-state/chat-assistant";

<FlowProvider flowKind="my-flow" userId={userId} renderers={chatAssistantRenderers}>
  <Conversation>
    <ItemsRenderer items={session.items} />
    <SourcesGroup items={session.items} />
  </Conversation>
</FlowProvider>
```

You can override individual entries (`{ ...chatAssistantRenderers, component: { ...chatAssistantRenderers.component, "task-board-meta": false } }`) or replace the whole map. Spread the existing `component` map first so the other keyed renderers stay.

## Architecture

Common components are framework-agnostic. Flow-aware components are typed against Flow State items. Generative UI is the only runtime-imported surface — bundles travel as a unit so a generator's tool list and a `FlowProvider`'s renderer map share the same names and schemas.

All components are fully customizable once installed. The registry distributes a starting point; the source in your repo is the contract.

Contributors writing or modifying components should also read [Writing UI Stories](/guides/writing-ui-stories) — registry components have Storybook stories for visual review, hosted at [storybook.flow-state.dev](https://storybook.flow-state.dev) with per-PR preview URLs.
