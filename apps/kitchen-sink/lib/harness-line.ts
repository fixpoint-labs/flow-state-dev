/**
 * Where a line typed into a harness session goes: into the turn running now,
 * when its harness takes it, or as the next turn.
 *
 * Isomorphic, and the one copy of the rule: the page sends every line through
 * {@link sendLine}, and the parity test drives the session flow through it
 * too, so what the test holds is what the page does. Nothing here names a
 * harness: whether a line can join the running turn is the run's answer
 * (`steer`'s `live` and `taken`), never the mode.
 *
 * The fallback runs here, on the sender's side. A page closed between the
 * `steer` answer and the `turn` send loses the line, as a failed `turn` send
 * already does.
 */

/** How a line is sent: the session flow's two actions. */
export interface LineSender {
  /** Hands the line to the running turn. `live`: the turn offered to take one; `taken`: it did. */
  steer(prompt: string): Promise<{ readonly taken: boolean; readonly live: boolean }>;
  /** Sends the line as a turn, which waits for one already running. */
  turn(prompt: string): Promise<void>;
}

/**
 * What became of a line: taken into the running turn, sent to run after it,
 * or sent as a turn because none was running. `dropped` only under a goal
 * control that breaks the fallback on purpose.
 */
export type LineOutcome = "taken" | "after-this-turn" | "turn" | "dropped";

/**
 * Send one line.
 *
 * @param prompt The line, trimmed.
 * @param running Whether a turn is running now, as the page last saw it. A
 *   turn that ended meanwhile offers nothing, so the line falls back to a turn.
 * @param sender The flow's actions.
 * @param control A goal control (`lib/goal-control.ts`): `drop-refused` drops a
 *   line the running turn refused; `drop-fallback` drops one no running turn
 *   could take. Each exists so the parity row can be seen to fail.
 */
export async function sendLine(
  prompt: string,
  running: boolean,
  sender: LineSender,
  control?: string,
): Promise<LineOutcome> {
  if (!running) {
    await sender.turn(prompt);
    return "turn";
  }
  const answer = await sender.steer(prompt);
  if (answer.taken) return "taken";
  if (answer.live ? control === "drop-refused" : control === "drop-fallback") return "dropped";
  await sender.turn(prompt);
  return "after-this-turn";
}
