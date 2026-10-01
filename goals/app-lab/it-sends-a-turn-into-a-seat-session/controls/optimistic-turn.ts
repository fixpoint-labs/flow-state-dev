/**
 * Control `optimistic-turn`: a line is drawn delivered without calling the
 * door.
 *
 * Built into the control page in place of `src/lib/send.ts`, App Lab's one
 * send path. `sendTurn` resolves at once and sends nothing, so every composer
 * shows *delivered* while no session holds the line. The goal must fail at
 * "delivered only once the session holds the line".
 */
export { TurnNotDelivered, type TurnTarget } from "../../../../labs/app-lab/src/lib/send.ts";

export async function sendTurn(): Promise<{ requestId: string }> {
  return { requestId: "never-sent" };
}
