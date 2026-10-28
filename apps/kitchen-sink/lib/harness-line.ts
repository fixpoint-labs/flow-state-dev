/**
 * The page's line rule: `@flow-state-dev/client`'s `sendHarnessLine`, with
 * Kitchen Sink's goal controls on it.
 *
 * The page sends every line through {@link sendLine}, and the parity test and
 * the goal drive the session flow through it too, so what they hold is what
 * the page does.
 */
import { sendHarnessLine, type HarnessLineOutcome, type HarnessLineSender } from "@flow-state-dev/client";

export type LineSender = HarnessLineSender;

/** What became of a line. `dropped` only under a goal control that breaks the fallback on purpose. */
export type LineOutcome = HarnessLineOutcome | "dropped";

/**
 * Send one line.
 *
 * @param prompt The line, trimmed.
 * @param running Whether a turn is running now, as the page last saw it.
 * @param sender The flow's actions.
 * @param control A goal control (`lib/goal-control.ts`): `drop-refused` drops a
 *   line the running turn refused; `drop-fallback` drops one no running turn
 *   could take. Each exists so the parity row can be seen to fail.
 */
export async function sendLine(prompt: string, running: boolean, sender: LineSender, control?: string): Promise<LineOutcome> {
  let answer: { readonly taken: boolean; readonly live: boolean } | undefined;
  let dropped = false;
  const outcome = await sendHarnessLine(prompt, running, {
    steer: async (text) => (answer = await sender.steer(text)),
    turn: async (text) => {
      if (answer !== undefined && (answer.live ? control === "drop-refused" : control === "drop-fallback")) {
        dropped = true;
        return;
      }
      await sender.turn(text);
    },
  });
  return dropped ? "dropped" : outcome;
}
