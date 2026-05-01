import { useEffect, useState } from "react";
import { DevToolPanel, readUserId } from "@flow-state-dev/devtool/react";

/**
 * Standalone DevTool shell. Reads `userId` from localStorage, mounts the
 * embeddable panel with `userIdControl="internal"` (panel manages identity)
 * and `autoRecoverInterrupted` on (this shell is the recovery surface).
 */
export function App() {
  // Resolve userId on mount — `readUserId` touches localStorage which isn't
  // available during SSR. The shell itself doesn't SSR but pulling the value
  // into state keeps the hook usage explicit and lets us re-read on focus.
  const [userId, setUserId] = useState(() => readUserId());

  useEffect(() => {
    const onFocus = () => setUserId(readUserId());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  return (
    <div className="h-screen">
      <DevToolPanel
        userId={userId}
        userIdControl="internal"
        autoRecoverInterrupted
      />
    </div>
  );
}
