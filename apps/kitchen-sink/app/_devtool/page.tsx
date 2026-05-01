"use client";

import { DevToolPanel } from "@flow-state-dev/devtool/react";

/**
 * Embedded DevTool panel for kitchen-sink. Mounted at `/_devtool` so PR and
 * Vercel previews are observable from the same origin as the main app.
 *
 * `userId` is hardcoded to `devuser` to mirror `<FlowProvider userId="devuser">`
 * in `app/page.tsx` — both surfaces share sessions because they hit the same
 * flow API as the same user.
 *
 * `userIdControl="host"` hides the panel's userId editor since the host owns
 * identity here.
 */
export default function DevToolPage() {
  return <DevToolPanel userId="devuser" userIdControl="host" />;
}
