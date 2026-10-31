# @flow-state-dev/devtool

**Pre-built DevTool static assets for `fsdev dev`.**

This package ships the compiled DevTool SPA. The CLI uses it to serve the DevTool UI alongside flow API routes. You don't interact with this package directly — install it, and `fsdev dev` picks it up.

The trace view's failed-block detail panel surfaces the error message, the `code`, and any `details` the runtime captured — raw model output and Zod issues for generator validation failures, and whatever an author attached to a thrown `FlowError`.

The block detail panel also surfaces per-block resource-load metrics (store fetch vs cache hit, wall time, prefetch source) for tuning collection `prefetchMode`. See [Observing resource loads](https://flow-state.dev/docs/devtool/observing-resource-loads).

## Quick Start

```bash
pnpm add -D @flow-state-dev/devtool
fsdev dev
```

The navigator groups flows by kind, with each kind's registered copies under it, identified by their exact IDs — see [Flow overview](https://flow-state.dev/docs/devtool/overview#flow-overview) for choosing between copies of one flow and opening a session under the one you picked.

The header switches between three themes, Paper, Draft and Night (the default). The choice is remembered per browser.

To open one session directly, add `?session=<id>` to the DevTool's address. It opens that session under the flow copy that owns it, or says why it can't — see [Opening a session from a link](https://flow-state.dev/docs/devtool/overview#opening-a-session-from-a-link). Embedded hosts pass the same as `DevToolPanel`'s `openSessionId` prop.

## API Surface

### `getAssetPath(): string`

Returns the absolute path to the directory containing the pre-built DevTool static assets (index.html, JS bundles, CSS).

Throws if the assets haven't been built yet.

```ts
import { getAssetPath } from "@flow-state-dev/devtool";

const dir = getAssetPath();
// → "/path/to/node_modules/@flow-state-dev/devtool/dist-client"
```

### `readDevtoolUrl(): string | undefined` and `traceHref(devtoolUrl, sessionId?): string`

From `@flow-state-dev/devtool/react`. `readDevtoolUrl()` returns the address of the DevTool served beside the current page by `fsdev dev --app`, read from the page's `fsdev-devtool-url` meta. It returns `undefined` when no DevTool is served, during server-side rendering, or when the value isn't an http(s) address. `traceHref()` returns the DevTool address that opens one session (`?session=<id>`), or the address unchanged when no session id is given.

```tsx
import { readDevtoolUrl, traceHref } from "@flow-state-dev/devtool/react";

function TraceLink({ sessionId }: { sessionId: string }) {
  const devtoolUrl = readDevtoolUrl();
  if (devtoolUrl === undefined) return null; // no DevTool served: hide the link
  return <a href={traceHref(devtoolUrl, sessionId)} target="_blank" rel="noreferrer">Open trace</a>;
}
```

## Building Assets

In the monorepo, build the DevTool app and copy its output:

```bash
pnpm --filter @flow-state-dev/devtool build:assets
```

This runs the Vite build for `apps/devtool` and copies the output to `dist-client/`.

## Scripts

```bash
pnpm --filter @flow-state-dev/devtool build         # Compile TypeScript
pnpm --filter @flow-state-dev/devtool build:assets   # Build DevTool app + copy assets
```
