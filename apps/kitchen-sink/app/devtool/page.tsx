"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { DevToolPanel } from "@flow-state-dev/devtool/react";

/**
 * Embedded DevTool panel for kitchen-sink. Mounted at `/devtool` so PR and
 * Vercel previews are observable from the same origin as the main app.
 *
 * `userId` is hardcoded to `devuser` to mirror `<FlowProvider userId="devuser">`
 * in `app/page.tsx` — both surfaces share sessions because they hit the same
 * flow API as the same user. Under E2E test mode, `?e2eUserId=...` overrides
 * this so a scenario can observe its own per-test session.
 *
 * `userIdControl="host"` hides the panel's userId editor since the host owns
 * identity here.
 */
export default function DevToolPage() {
  return (
    <Suspense fallback={null}>
      <DevToolPageInner />
    </Suspense>
  );
}

function DevToolPageInner() {
  const searchParams = useSearchParams();
  const e2eUserId =
    process.env.NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE === "1"
      ? searchParams.get("e2eUserId")
      : null;
  const userId = e2eUserId ?? "devuser";
  return (
    <div data-testid="devtool-panel">
      <DevToolPanel userId={userId} userIdControl="host" />
    </div>
  );
}
