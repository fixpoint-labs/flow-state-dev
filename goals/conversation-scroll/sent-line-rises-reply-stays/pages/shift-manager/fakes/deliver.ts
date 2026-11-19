/** A line sent goes into the script. See `../shared.ts`. */
export * from "../../../lib/deliver";
import { script } from "../../script";

export function useDeliverLine() {
  return async (to: { sessionId: string }, message: string, options: { onHeld?: () => void } = {}) => {
    await script.send(to.sessionId, message);
    options.onHeld?.();
    return { requestId: "r", suspended: false, stopped: null };
  };
}
