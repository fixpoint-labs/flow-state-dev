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
  // unavailable during SSR. State holds boot-time values; userId re-syncs on
  // focus only when identity is not injected from `fsdev.config.ts`.
  const [userId, setUserId] = useState(() => readUserId());
  const [bearerToken] = useState(() => readBearerToken());

  useEffect(() => {
    const onFocus = () => {
      // Injected config is fixed until reload; re-reading it on focus would undo
      // Settings edits. Bearer tokens are never persisted — only provider state —
      // so focus must not re-read the injected global either.
      if (!hasInjectedUserId()) {
        setUserId(readUserId());
      }
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
