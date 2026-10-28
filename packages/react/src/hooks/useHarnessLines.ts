/**
 * Lines typed into a harness session while its turns run: each goes into the
 * running turn when the run takes it, or runs as a turn after the ones before
 * it, in the order typed, and the session view stays on the running turn
 * until it ends.
 *
 * The rule for one line is the client's `sendHarnessLine`; this hook owns
 * what a page needs around it. A turn sent while one runs goes through the
 * client, not the session view, which would leave the running turn's stream
 * for the new request. The hook keeps those turns and follows each with
 * `followRequest` once the turn before it has ended. A view opened while
 * turns wait follows the oldest running one first.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  harnessLines,
  sendHarnessLine,
  steerRunningTurn,
  type HarnessLineOutcome,
  type HarnessLineSender
} from "@flow-state-dev/client";
import { useClient } from "../internal/useClient";
import type { SessionView } from "./useSession";

/** Options for {@link useHarnessLines}. */
export type UseHarnessLinesOptions<TOutcome extends string = HarnessLineOutcome> = {
  /** The flow's turn action, which takes `{ prompt }`. Declare it `concurrency: "defer"`. Default `"turn"`. */
  turnAction?: string;
  /** The flow's steer action (core's `harnessSteering`). Default `"steer"`. */
  steerAction?: string;
  /** How one line is sent. Default the client's `sendHarnessLine`. */
  sendOne?: (prompt: string, running: boolean, sender: HarnessLineSender) => Promise<TOutcome>;
};

/** What {@link useHarnessLines} returns. */
export type HarnessLinesView<TOutcome extends string = HarnessLineOutcome> = {
  /** Send one line, after every line sent before it has its answer. Resolves with where it went. */
  send: (prompt: string) => Promise<TOutcome>;
};

/** How many running requests are read to find the session's turns. */
const RUNNING_READ_LIMIT = 20;

/**
 * How many times a running turn is followed again after its stream drops, before the view stays off it.
 * Past that, the waiting turns are not followed either while it runs: a reload shows them.
 */
const MAX_REATTACH = 3;

/**
 * Send a harness session's lines, in the order typed, while the session view
 * stays on the running turn.
 *
 * While a turn this hook sent still waits, no line steers: one taken into the
 * running turn would reach the agent ahead of the waiting one.
 *
 * @param session The session's view, from `useSession`.
 */
export function useHarnessLines<TOutcome extends string = HarnessLineOutcome>(
  session: SessionView,
  options: UseHarnessLinesOptions<TOutcome> = {}
): HarnessLinesView<TOutcome> {
  const { flowKind, sessionId, userId, isStreaming, isLoading, followRequest, sendAction } = session;
  const turnAction = options.turnAction ?? "turn";
  const steerAction = options.steerAction ?? "steer";
  const sendOneRef = useRef(options.sendOne);
  sendOneRef.current = options.sendOne;
  const client = useClient({ userId });

  const streaming = useRef(isStreaming);
  streaming.current = isStreaming;
  const viewedSession = useRef(sessionId);
  viewedSession.current = sessionId;
  // Turns sent while one ran, oldest first. Each waits on the server for the one before it.
  const waiting = useRef<string[]>([]);
  const checkingRunning = useRef(false);
  // How many times each running turn was followed again after its stream dropped.
  const reattached = useRef(new Map<string, number>());

  const lines = useMemo(
    () =>
      harnessLines<TOutcome>((prompt, running, sender) =>
        (sendOneRef.current ?? (sendHarnessLine as never))(prompt, running, sender)
      ),
    []
  );
  useEffect(() => lines.turnChanged(), [lines, isStreaming]);

  /** The session's running turns, oldest first. */
  const runningTurns = useCallback(
    async (id: string) =>
      (await client.sessions.requests(id, { status: "in_progress", limit: RUNNING_READ_LIMIT }))
        .filter((request) => request.actionName === turnAction)
        .sort((a, b) => (a.startedAtMs ?? 0) - (b.startedAtMs ?? 0)),
    [client, turnAction]
  );

  const followWaiting = useCallback(() => {
    if (sessionId === undefined || streaming.current || checkingRunning.current || waiting.current.length === 0) return;
    // A stream that drops stops streaming too, while its turn still runs: read
    // which turn runs before moving on from it.
    checkingRunning.current = true;
    runningTurns(sessionId).then(
      (turns) => {
        checkingRunning.current = false;
        // Read for a session the view has since left: its turns are not this view's to follow.
        if (streaming.current || viewedSession.current !== sessionId) return;
        const running = turns[0];
        // The turn followed still runs, and only its stream ended: follow it
        // again, so its end moves the view on to the waiting turn.
        if (running !== undefined && !waiting.current.includes(running.id)) {
          const drops = (reattached.current.get(running.id) ?? 0) + 1;
          reattached.current.set(running.id, drops);
          if (drops > MAX_REATTACH) return;
          streaming.current = true;
          followRequest(running.id);
          return;
        }
        const next = waiting.current.shift();
        if (next === undefined) return;
        // Following until the next render says so, so a second call follows nothing more.
        streaming.current = true;
        followRequest(next);
      },
      // Unread, the view stays on the request it follows.
      () => {
        checkingRunning.current = false;
      }
    );
  }, [sessionId, runningTurns, followRequest]);
  useEffect(() => {
    if (!isStreaming) followWaiting();
  }, [isStreaming, followWaiting]);

  // A view opened while turns wait follows the session's newest request, which
  // is a waiting one: follow the oldest running turn instead, and the rest after it.
  const checkedOpen = useRef<string | null>(null);
  useEffect(() => {
    if (sessionId === undefined || isLoading || checkedOpen.current === sessionId) return;
    checkedOpen.current = sessionId;
    waiting.current = [];
    reattached.current.clear();
    runningTurns(sessionId).then(
      (turns) => {
        const oldest = turns[0];
        if (checkedOpen.current !== sessionId || oldest === undefined || turns.length < 2) return;
        const listed = turns.slice(1).map((request) => request.id);
        // A line sent while the list was read is kept, after the ones it lists.
        waiting.current = [...listed, ...waiting.current.filter((id) => !listed.includes(id))];
        followRequest(oldest.id);
      },
      // Unread, the view stays on the request it follows.
      () => undefined
    );
  }, [sessionId, isLoading, runningTurns, followRequest]);

  const send = useCallback(
    (prompt: string): Promise<TOutcome> => {
      if (sessionId === undefined) return Promise.reject(new Error("useHarnessLines needs a session id"));
      const sender: HarnessLineSender = {
        steer: async (text) => {
          // Read when the line's turn comes, after the lines before it.
          if (waiting.current.length > 0) return { taken: false, live: false };
          return steerRunningTurn(client, { flowKind, sessionId, prompt: text, action: steerAction });
        },
        turn: async (text) => {
          if (!streaming.current) {
            await sendAction(turnAction, { prompt: text }, { userMessage: text });
            return;
          }
          const sent = await client.flow(flowKind).send(turnAction, { prompt: text }, { sessionId });
          waiting.current.push(sent.id);
          // The running turn may have ended while the line was sent.
          followWaiting();
        }
      };
      return lines.send(prompt, streaming.current, sender);
    },
    [client, flowKind, sessionId, steerAction, turnAction, sendAction, followWaiting, lines]
  );

  return { send };
}
