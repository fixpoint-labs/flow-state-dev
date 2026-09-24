"use client";

import { DevToolPanel } from "@flow-state-dev/devtool/react";
import { KITCHEN_SINK_USER_ID } from "@/lib/kitchen-sink-principal";

/**
 * Embedded DevTool panel for kitchen-sink. Mounted at `/devtool` so PR and
 * Vercel previews are observable from the same origin as the main app.
 *
 * `userId` is the app's one user, the same one `app/page.tsx` passes: the
 * server resolves every caller to it (`lib/kitchen-sink-principal.ts`), so both
 * surfaces see the same sessions.
 *
 * `userIdControl="host"` hides the panel's userId editor since the host owns
 * identity here.
 */
export default function DevToolPage() {
  return (
    <div data-testid="devtool-panel" className="h-full">
      <DevToolPanel userId={KITCHEN_SINK_USER_ID} userIdControl="host" />
    </div>
  );
}
