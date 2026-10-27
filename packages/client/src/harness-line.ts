/**
 * Where a line typed into a harness session goes: into the turn running now,
 * when its harness takes it, or as the next turn.
 *
 * The server half is core's `harnessSteering`: a flow declares its `steer`
 * action beside its `turn` action. {@link sendHarnessLine} is the rule a page
 * follows with those two actions, and {@link steerRunningTurn} sends `steer`
 * without touching the stream a session hook is following. Nothing here names
 * a harness: whether a line can join the running turn is the run's answer.
 *
 * The fallback runs on the sender's side. A page closed between the `steer`
 * answer and the `turn` send loses the line, as a failed `turn` send does.
 */
import type { Client } from "./client";

/** How a line is sent: the session flow's two actions. */
export interface HarnessLineSender {
  /** Hands the line to the running turn. `live`: the turn offered to take one; `taken`: it did. */
  steer(prompt: string): Promise<{ readonly taken: boolean; readonly live: boolean }>;
  /** Sends the line as a turn, which waits for one already running. */
  turn(prompt: string): Promise<void>;
}

/** What became of a line: taken into the running turn, sent to run after it, or sent as a turn because none was running. */
export type HarnessLineOutcome = "taken" | "after-this-turn" | "turn";

/**
 * Send one line.
 *
 * @param prompt The line, trimmed.
 * @param running Whether a turn is running now, as the page last saw it. A
 *   turn that ended meanwhile offers nothing, so the line falls back to a turn.
 * @param sender The flow's actions.
 */
export async function sendHarnessLine(prompt: string, running: boolean, sender: HarnessLineSender): Promise<HarnessLineOutcome> {
  if (!running) {
    await sender.turn(prompt);
    return "turn";
  }
  if ((await sender.steer(prompt)).taken) return "taken";
  await sender.turn(prompt);
  return "after-this-turn";
}

/** One sender's lines, in the order they were typed. See {@link harnessLines}. */
export interface HarnessLines<TOutcome extends string = HarnessLineOutcome> {
  /**
   * Send one line after every line sent before it has its answer.
   *
   * @param running Whether a turn is running now, as the page sees it.
   */
  send(prompt: string, running: boolean, sender: HarnessLineSender): Promise<TOutcome>;
  /** Call when the running turn changes or ends: lines may steer the new one. */
  turnChanged(): void;
}

/**
 * Keep one sender's lines in the order they were typed.
 *
 * Each line waits for the one before it to have its answer. And once a line
 * has gone to run after the running turn, the lines after it go the same way
 * until the turn changes: steered into the running turn, a later line would
 * reach the agent before the earlier one.
 *
 * @param sendOne How one line is sent. Default {@link sendHarnessLine}.
 */
export function harnessLines<TOutcome extends string = HarnessLineOutcome>(
  sendOne: (prompt: string, running: boolean, sender: HarnessLineSender) => Promise<TOutcome> = sendHarnessLine as never,
): HarnessLines<TOutcome> {
  let chain: Promise<unknown> = Promise.resolve();
  let behind = false;
  return {
    send(prompt, running, sender) {
      const sent = chain.then(async () => {
        const outcome = await sendOne(prompt, running && !behind, sender);
        if (outcome === "after-this-turn") behind = true;
        return outcome;
      });
      chain = sent.catch(() => undefined);
      return sent;
    },
    turnChanged() {
      behind = false;
    },
  };
}

/** Options for {@link steerRunningTurn}. */
export interface SteerRunningTurnOptions {
  readonly flowKind: string;
  readonly sessionId: string;
  readonly prompt: string;
  /** The flow's steer action. Default `"steer"`. */
  readonly action?: string;
  /** How often to poll the request while it runs. Default 150 ms. */
  readonly pollMs?: number;
}

/**
 * Send the flow's steer action and read its answer. It goes through `client`
 * on its own, not a session hook, so the stream following the running turn
 * stays on that turn. A steer that failed, or whose answer can't be read,
 * reads as not taken, so the line falls back to a turn.
 */
export async function steerRunningTurn(
  client: Client,
  options: SteerRunningTurnOptions,
): Promise<{ readonly taken: boolean; readonly live: boolean }> {
  const sent = await client.flow(options.flowKind).send(options.action ?? "steer", { prompt: options.prompt }, { sessionId: options.sessionId });
  await sent.wait({ pollMs: options.pollMs ?? 150 });
  // The status snapshot carries no output; the session's request listing does.
  const requests = await client.sessions.requests(options.sessionId, { includeResultOutput: true, limit: 20 });
  const output = requests.find((request) => request.id === sent.id)?.result?.output as
    | { taken?: unknown; live?: unknown }
    | undefined;
  return { taken: output?.taken === true, live: output?.live === true };
}
