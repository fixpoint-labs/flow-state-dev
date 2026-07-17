import { useEffect, useState } from "react";
import {
  DevToolPanel,
  readUserId,
  readBearerToken,
  hasInjectedUserId,
} from "@flow-state-dev/devtool/react";

/**
 * Standalone DevTool shell. Resolves `userId` and `bearerToken` from the
 * page config (`fsdev dev` injects them from `fsdev.config.ts`, falling back to
 * localStorage / default for userId), mounts the embeddable panel with
 * `userIdControl="internal"` and `autoRecoverInterrupted` on.
 */
export function App() {
  // Resolve on mount — these touch `window` (localStorage / injected global),
  // unavailable during SSR. State holds boot-time values; focus re-syncs userId
  // from localStorage only when config did not inject userId, and clears the
  // bearer prop on that sync so a partial injection cannot re-authorize token.
  const [userId, setUserId] = useState(() => readUserId());
  const [bearerToken, setBearerToken] = useState(() => readBearerToken());

  useEffect(() => {
    // Injected userId is fixed until reload; cross-tab sync applies only without it.
    if (hasInjectedUserId()) return;

    const onFocus = () => {
      setUserId(readUserId());
      // Boot-time injected bearer lives in shell state forever if we keep it on
      // the prop. A userId-only focus sync would still push that stale token into
      // SYNC_EXTERNAL_CONFIG and undo Settings clears — drop the prop so merge
      // keeps provider state (partial devtool config: bearer only).
      setBearerToken(undefined);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  return (
    <div className="h-screen">
      <DevToolPanel
        userId={userId}
        bearerToken={bearerToken}
        userIdControl="internal"
        autoRecoverInterrupted
      />
    </div>
  );
}
