---
sidebar_position: 3
title: "Embedding DevTool"
---

# Embedding DevTool

The DevTool isn't just the standalone `fsdev dev` UI. The same panel ships as a React component you can mount inside any framework app. This is useful for inspecting flows running on a deployed environment (PR previews, staging) without leaving the app's own origin.

## When to use the panel

Mount the panel inside your app when:

- You want to inspect a flow on a Vercel preview without running `fsdev dev` locally against the deployed API.
- You want a single dev-only surface for the team to verify flow behavior end-to-end alongside the rest of the UI.
- The host app already has auth, routing, and CSS scoping you'd otherwise need to reproduce.

For local iteration, `fsdev dev` is still the lighter path. The embedded panel is for environments where you can't (or don't want to) point a separate DevTool process at the API.

## Install

```bash
pnpm add @flow-state-dev/devtool
```

The package ships:

- `@flow-state-dev/devtool` — the standalone-asset entry used by `fsdev dev` (unchanged).
- `@flow-state-dev/devtool/react` — the embeddable React component.
- `@flow-state-dev/devtool/react/styles.css` — the panel's Tailwind v4 source CSS.

`react` and `react-dom` are peer dependencies (^19).

## Mount the panel

The minimal Next.js setup is a per-route layout that imports the panel CSS, plus a client-only page:

```tsx
// app/devtool/layout.tsx
import "@flow-state-dev/devtool/react/styles.css";

export default function DevToolLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-screen w-screen">{children}</div>;
}
```

```tsx
// app/devtool/page.tsx
"use client";
import { DevToolPanel } from "@flow-state-dev/devtool/react";

export default function DevToolPage() {
  return <DevToolPanel userId="devuser" userIdControl="host" />;
}
```

The panel fills its container — give it a parent with explicit height (the layout above uses `h-screen`).

## Props

| Prop | Type | Default | What it does |
| -- | -- | -- | -- |
| `userId` | `string` | required | Identity used for every flow-API call. The host owns it. |
| `baseUrl` | `string` | `""` (same-origin) | Base URL forwarded to the flow-API clients. |
| `autoRecoverInterrupted` | `boolean` | `false` | When `true`, sweeps interrupted requests on mount. The standalone shell sets this; embedded mounts default off so the panel doesn't mutate request state in the host app. |
| `userIdControl` | `"host" \| "internal"` | `"internal"` | `"host"` hides the SettingsSheet user-id editor. Use `"host"` whenever the host app supplies `userId`. |
| `className` | `string` | — | Extra class on the panel root. |

## CSS

The panel ships its CSS as Tailwind v4 source, not precompiled. The consumer's Tailwind build picks up the utilities the panel uses.

Two consequences:

- The host must run Tailwind v4. (Kitchen-sink does, so this is the supported case today.)
- The panel's CSS only scopes cleanly when imported in a route-level layout — Next.js per-route CSS scoping keeps the panel's styles from bleeding into the rest of the app.

A precompiled CSS variant for non-Tailwind hosts is on the roadmap.

## Production gating

The panel is dev tooling. Most hosts will want it absent in production.

The recommended pattern is a guard in the page itself:

```tsx
"use client";
import { DevToolPanel } from "@flow-state-dev/devtool/react";

export default function DevToolPage() {
  if (process.env.NEXT_PUBLIC_FSD_DEVTOOL !== "1" && process.env.NODE_ENV === "production") {
    return null;
  }
  return <DevToolPanel userId="devuser" userIdControl="host" />;
}
```

Tree-shaking won't strip the panel just because of this guard. For security-sensitive consumers, also exclude the route at the framework level (Next.js: route group + middleware, or a separate dev-only sub-app).

## Identity

The panel and your main app share sessions when they hit the same flow API as the same `userId`. The kitchen-sink reference deployment hardcodes `userId="devuser"` in both places for that reason.

When `userIdControl="host"` the panel does not write `userId` to localStorage — identity stays fully in the host. When `userIdControl="internal"` (the standalone shell), the SettingsSheet exposes a userId editor and persists changes to localStorage.

## Known limitations

- **No custom-component rendering.** The embedded panel renders `component` items in debug view, the same as the standalone tool. Renderer-registry inheritance (so the panel can use the host's renderers) is tracked separately as a follow-up.
- **No interrupted-request sweep by default.** If a request died while the host server kept running, the panel won't surface it as "interrupted" until the standalone tool or `fsdev dev` runs the recovery sweep. Set `autoRecoverInterrupted` if you want the embedded panel to do it instead.
- **Settings userId switch.** When `userIdControl="internal"`, switching userId in the SettingsSheet does not currently refresh the session list. A bug fix is tracked separately. This is hidden in `userIdControl="host"` mode because the editor isn't rendered.
