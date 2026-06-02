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

## API Surface

### `getAssetPath(): string`

Returns the absolute path to the directory containing the pre-built DevTool static assets (index.html, JS bundles, CSS).

Throws if the assets haven't been built yet.

```ts
import { getAssetPath } from "@flow-state-dev/devtool";

const dir = getAssetPath();
// → "/path/to/node_modules/@flow-state-dev/devtool/dist-client"
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
