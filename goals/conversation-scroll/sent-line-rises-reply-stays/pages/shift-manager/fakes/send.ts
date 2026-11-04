/** A line sent goes into the script. See `../shared.ts`. */
export * from "../../../lib/send";
import { script } from "../../script";

export async function sendTurn(_client: unknown, target: { sessionId: string }, message: string, options: { onHeld?: () => void } = {}) {
  await script.send(target.sessionId, message);
  options.onHeld?.();
  return { requestId: "r", suspended: false, stopped: null };
}
