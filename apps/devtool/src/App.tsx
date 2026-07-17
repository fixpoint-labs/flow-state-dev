import { useEffect, useState } from "react";
import { DevToolPanel, readUserId, readBearerToken } from "@flow-state-dev/devtool/react";

/**
 * Standalone DevTool shell. Resolves `userId` and `bearerToken` from the
 * page config (`fsdev dev` injects them from `fsdev.config.ts`, falling back to
 * localStorage / default for userId), mounts the embeddable panel with
 * `userIdControl="internal"` and `autoRecoverInterrupted` on.
 */
export function App() {
  // Resolve on mount — these touch `window` (localStorage / injected global),
  // unavailable during SSR. Pulling them into state keeps the hook usage
  // explicit and lets us re-read on focus.
  const [userId, setUserId] = useState(() => readUserId());
  const [bearerToken, setBearerToken] = useState(() => readBearerToken());

  useEffect(() => {
    const onFocus = () => {
      setUserId(readUserId());
      setBearerToken(readBearerToken());
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
