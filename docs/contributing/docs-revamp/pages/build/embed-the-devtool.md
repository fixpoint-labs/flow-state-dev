---
title: Embed the DevTool in your app
type: recipe
description: Mount the DevTool as a route of your Next.js app so a deployed copy can be inspected from its own origin, and decide who is allowed to open it.
---

# Embed the DevTool in your app

The DevTool is a browser page that shows what your flows did: every session, request and block, and what each model was told. A flow is a self-contained system in your app that clients call by action name. `fsdev dev` serves the DevTool next to your code on your machine. On a preview or staging deployment, `fsdev dev` is not running, so the DevTool is also a React component, `DevToolPanel`, that you mount as a route of your own app and reach from the same origin.

The panel talks to the same flow API your app's own client calls, as whichever user you tell it to be. The last step decides who can see your runs.

This recipe adds the panel to a support desk app at `/devtool`. The host app needs React 19 and Tailwind v4 ([package requirements](../reference/api/devtool.md)).

## 1. Install

```bash
pnpm add @flow-state-dev/devtool
```

It is a regular dependency, not a dev one, because your build imports it.

## 2. Mount the route

The layout imports the panel's stylesheet and gives the panel a parent with a height. The stylesheet is Tailwind source, so your Tailwind build compiles it. Importing it in this route's layout, not the root layout, keeps its base styles off your other pages. `dynamic = "force-dynamic"` stops Next.js prerendering this browser-only route.

```tsx title="src/app/devtool/layout.tsx"
import "@flow-state-dev/devtool/react/styles.css";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function DevToolLayout({ children }: { children: ReactNode }) {
  return <div className="h-screen w-screen">{children}</div>;
}
```

The panel runs only in the browser, so it lives in a client component. It takes the user it acts as from the host.

```tsx title="src/app/devtool/panel.tsx"
"use client";

import { DevToolPanel } from "@flow-state-dev/devtool/react";

export function Panel({ userId }: { userId: string }) {
  return <DevToolPanel userId={userId} userIdControl="host" className="h-full" />;
}
```

`userIdControl="host"` hides the user and bearer-token fields in the panel's Settings, so the user you pass is the user it acts as ([props](../reference/api/devtool.md)). The page reads the signed-in user on the server and hands the id down. `currentUser` is your app's own helper, in `src/lib/current-user.ts`, that returns the signed-in user.

```tsx title="src/app/devtool/page.tsx"
import { currentUser } from "../../lib/current-user";
import { Panel } from "./panel";

export default async function DevToolPage() {
  const user = await currentUser();
  return <Panel userId={user.id} />;
}
```

Open `/devtool`. The panel lists that user's sessions, the same ones your app's chat page shows for them. If your flow API is not on this page's origin, or your app is served under a base path, pass the API's URL as `baseUrl`. It defaults to the page's own origin.

## 3. Restrict it

Who can open it in production? Anyone your app lets request `/devtool`. What they see is whatever the flow API returns for the user the panel acts as. The panel has no `NODE_ENV` check and no "enabled" prop ([props](../reference/api/devtool.md)). Rendering nothing is not restricting: a page check that returns `null` in production leaves the route in place, the flow API answers the same callers, and the panel code ships in the client bundle all the same.

Gate the route in your host. This middleware answers 404 to anyone who is not signed in as staff. `isStaff`, in `src/lib/is-staff.ts`, is another helper of yours: it says whether the request comes from a signed-in staff member.

```ts title="src/middleware.ts"
import { NextResponse, type NextRequest } from "next/server";
import { isStaff } from "./lib/is-staff";

export async function middleware(request: NextRequest) {
  if (await isStaff(request)) return NextResponse.next();
  return new NextResponse(null, { status: 404 });
}

export const config = { matcher: "/devtool/:path*" };
```

The panel can act, not only read: it sends any action the flow declares and resolves runs waiting for approval ([what it can do](../reference/api/devtool.md)). Treat access to `/devtool` as access to those.

The route gate does not cover the flow API. By default the API takes the user id from the request body, which a caller controls. Resolve the user from a verified request instead, as [Authentication](../reference/authentication.md) shows.

In production, a block's view shows only its identity and output. To see its input, prompt, messages and history, set `FSDEV_TRACE_OBSERVABILITY=true`. Prompts are then recorded. The Resources and Suspensions views need `FSDEV_DEBUG_ENDPOINTS=1`. Leave that off on any deployment others can reach: it exposes a session's full server state. Both are in [Environment variables](../reference/environment.md).

## Next

- [Debug a run with the DevTool](./debug-a-run.md): what to do with the panel once it is mounted.
- [DevTool reference](../reference/api/devtool.md): every prop and helper.
- [Authentication](../reference/authentication.md): resolving the user from a verified request.
