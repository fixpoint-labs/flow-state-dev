/**
 * Lines typed into a session while its turns run: each goes into the running
 * turn when the run takes it, or runs as a turn after the ones before it, in
 * the order typed, and the session view stays on the running turn until it
 * ends. Any flow whose turn action waits for the one running (`defer`) can
 * use it, a harness session or a plain chat.
 *
 * The rule for one line is the client's `sendHarnessLine`; this hook owns
 * what a page needs around it. A turn sent while one runs goes through the
 * client, not the session view, which would leave the running turn's stream
 * for the new request. The hook keeps one such turn waiting on the server at
 * a time, since `defer` starts waiting requests one at a time but in no set
 * order: later lines wait in the page, and the next is sent once the one
 * before it has started. It follows each with `followRequest` once the turn
 * before it has ended, and returns the lines still waiting, for a page to
 * mark. A view opened while turns wait follows the oldest running one first.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /** The flow's turn action. Declare it `concurrency: "defer"`. Default `"turn"`. */
  turnAction?: string;
  /**
   * The turn action's input for a line, read when the line is sent. Default
   * `{ prompt: line }`.
   */
  input?: (line: string) => unknown;
  /** The flow's steer action (core's `harnessSteering`). Default `"steer"`. */
  steerAction?: string;
  /** How one line is sent. Default the client's `sendHarnessLine`. */
  sendOne?: (prompt: string, running: boolean, sender: HarnessLineSender) => Promise<TOutcome>;
};

/** A line waiting for the running turn, in {@link HarnessLinesView.waiting}. */
export type HarnessWaitingLine = {
  /** Stable while the line waits: a key for a list. */
  key: string;
  /** The line as typed. Absent for a turn this page didn't send, such as one a reload found waiting. */
  text?: string;
};

/** What {@link useHarnessLines} returns. */
export type HarnessLinesView<TOutcome extends string = HarnessLineOutcome> = {
  /**
   * Send one line, after every line sent before it has its answer. Resolves
   * with where it went; a line that waits resolves once it is listed in
   * `waiting`, and rejects if its turn could not be sent.
   */
  send: (prompt: string) => Promise<TOutcome>;
  /**
   * The lines waiting for the running turn, oldest first, until each one's
   * turn is followed. At most one is on the server; the rest wait in the page
   * and are sent in order, so a reload or a closed tab loses those. Moving
   * the view to another session sends the held ones to the session left.
   */
  waiting: readonly HarnessWaitingLine[];
};

/** One waiting line: on the server once `requestId` is set, else held in the page until the line before it starts. */
type QueuedLine = {
  key: string;
  text?: string;
  input?: unknown;
  requestId?: string;
  /** Its turn's send is out. */
  sending?: boolean;
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
  const { flowKind, sessionId, userId, isStreaming, isLoading, followRequest, sendAction, items } = session;
  const turnAction = options.turnAction ?? "turn";
  const steerAction = options.steerAction ?? "steer";
  const sendOneRef = useRef(options.sendOne);
  sendOneRef.current = options.sendOne;
  const inputRef = useRef(options.input);
  inputRef.current = options.input;
  const client = useClient({ userId });

  const streaming = useRef(isStreaming);
  streaming.current = isStreaming;
  const viewedSession = useRef(sessionId);
  viewedSession.current = sessionId;
  // Lines whose turns wait for the one running, oldest first: the first on the
  // server, the rest held here until the one before them starts.
  const queue = useRef<QueuedLine[]>([]);
  const [waiting, setWaiting] = useState<readonly HarnessWaitingLine[]>([]);
  const publish = useCallback(() => {
    setWaiting(queue.current.map(({ key, text }) => (text === undefined ? { key } : { key, text })));
  }, []);
  const keys = useRef(0);
  // The waiting turn the view last moved to, until its first item shows it started.
  const starting = useRef<string | null>(null);
  /** The view follows a waiting turn that hasn't started: a line sent now must not wait beside it. */
  const startPending = () => starting.current !== null && streaming.current;
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

  /** The turn's input for `line`. */
  const inputOf = useCallback((line: string) => (inputRef.current === undefined ? { prompt: line } : inputRef.current(line)), []);

  /** Send `line`'s turn to wait behind the running one; a failed send drops it from the waiting lines. */
  const sendQueued = useCallback(
    async (line: QueuedLine, onSent: () => void) => {
      if (sessionId === undefined) return;
      line.sending = true;
      try {
        const sent = await client.flow(flowKind).send(turnAction, line.input, { sessionId });
        line.requestId = sent.id;
      } catch (error) {
        queue.current = queue.current.filter((other) => other !== line);
        publish();
        throw error;
      } finally {
        line.sending = false;
      }
      // The running turn may have ended while the line was sent.
      onSent();
    },
    [client, flowKind, sessionId, turnAction, publish]
  );

  // `followWaiting` and `sendHeld` call each other; the ref breaks the cycle.
  const followWaitingRef = useRef<() => void>(() => undefined);

  /**
   * Send the oldest held line, once no line waits on the server and the turn
   * the view moved to has started: two waiting `defer` turns start in no set
   * order, so only one waits at a time.
   */
  const sendHeld = useCallback(() => {
    if (startPending()) return;
    if (queue.current.some((line) => line.requestId !== undefined || line.sending === true)) return;
    const next = queue.current[0];
    if (next === undefined) return;
    sendQueued(next, () => followWaitingRef.current()).catch((error: unknown) => {
      // Its send went out after `send` resolved: nothing awaits it to reject.
      console.error("[useHarnessLines] a waiting line could not be sent", error);
      sendHeld();
    });
  }, [sendQueued]);

  // The turn the view moved to has its first item: it started, so the next held line can wait behind it.
  useEffect(() => {
    if (starting.current === null || !(items ?? []).some((item) => item.requestId === starting.current)) return;
    starting.current = null;
    sendHeld();
  }, [items, sendHeld]);

  const followWaiting = useCallback(() => {
    if (sessionId === undefined || streaming.current || checkingRunning.current || queue.current.length === 0) return;
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
        // again, so its end moves the view on to the waiting turn. One the
        // person stopped is not followed again: move on to the waiting turn.
        if (running !== undefined && !queue.current.some((line) => line.requestId === running.id)) {
          const drops = (reattached.current.get(running.id) ?? 0) + 1;
          reattached.current.set(running.id, drops);
          if (drops > MAX_REATTACH) return;
          streaming.current = true;
          if (followRequest(running.id) !== false) return;
          streaming.current = false;
        }
        // The turn the view moved to has ended, started or not: a held line may go.
        starting.current = null;
        const next = queue.current[0];
        // Its turn isn't on the server yet: send it, and follow it once it is.
        if (next?.requestId === undefined) {
          sendHeld();
          return;
        }
        queue.current.shift();
        publish();
        // Following until the next render says so, so a second call follows nothing more.
        streaming.current = true;
        starting.current = next.requestId;
        followRequest(next.requestId);
      },
      // Unread, the view stays on the request it follows.
      () => {
        checkingRunning.current = false;
      }
    );
  }, [sessionId, runningTurns, followRequest, sendHeld, publish]);
  followWaitingRef.current = followWaiting;
  useEffect(() => {
    if (!isStreaming) followWaiting();
  }, [isStreaming, followWaiting]);

  // A view opened while turns wait follows the session's newest request, which
  // is a waiting one: follow the oldest running turn instead, and the rest after it.
  const checkedOpen = useRef<string | null>(null);
  useEffect(() => {
    if (sessionId === undefined || isLoading || checkedOpen.current === sessionId) return;
    const left = checkedOpen.current;
    // Lines still held for the session being left go to its server now, oldest
    // first, so leaving the session doesn't drop them. Each waits there under
    // `defer`, which may start them in another order.
    const held = queue.current.filter((line) => line.requestId === undefined && line.sending !== true);
    if (left !== null && held.length > 0) {
      void (async () => {
        for (const line of held) {
          try {
            await client.flow(flowKind).send(turnAction, line.input, { sessionId: left });
          } catch (error) {
            console.error("[useHarnessLines] a waiting line could not be sent", error);
          }
        }
      })();
    }
    checkedOpen.current = sessionId;
    queue.current = [];
    starting.current = null;
    publish();
    reattached.current.clear();
    runningTurns(sessionId).then(
      (turns) => {
        const oldest = turns[0];
        if (checkedOpen.current !== sessionId || oldest === undefined || turns.length < 2) return;
        const listed = turns.slice(1).map((request) => request.id);
        // A line sent while the list was read is kept, after the ones it lists.
        queue.current = [
          ...listed.map((id): QueuedLine => ({ key: id, requestId: id })),
          ...queue.current.filter((line) => line.requestId === undefined || !listed.includes(line.requestId))
        ];
        publish();
        followRequest(oldest.id);
      },
      // Unread, the view stays on the request it follows.
      () => undefined
    );
  }, [sessionId, isLoading, runningTurns, followRequest, publish, client, flowKind, turnAction]);

  const send = useCallback(
    (prompt: string): Promise<TOutcome> => {
      if (sessionId === undefined) return Promise.reject(new Error("useHarnessLines needs a session id"));
      const sender: HarnessLineSender = {
        steer: async (text) => {
          // Read when the line's turn comes, after the lines before it.
          if (queue.current.length > 0) return { taken: false, live: false };
          return steerRunningTurn(client, { flowKind, sessionId, prompt: text, action: steerAction });
        },
        turn: async (text) => {
          const input = inputOf(text);
          if (!streaming.current && queue.current.length === 0) {
            await sendAction(turnAction, input, { userMessage: text });
            return;
          }
          const line: QueuedLine = { key: `line-${++keys.current}`, text, input };
          queue.current = [...queue.current, line];
          publish();
          // Only the oldest line is ever sent. One before this waits on the server or
          // is held: this one waits here, and is sent in its turn. A held one may go now.
          if (queue.current[0] !== line) {
            sendHeld();
            return;
          }
          // The turn the view moved to hasn't started: this one waits for it.
          if (startPending()) return;
          await sendQueued(line, followWaiting);
        }
      };
      return lines.send(prompt, streaming.current || queue.current.length > 0, sender);
    },
    [client, flowKind, sessionId, steerAction, turnAction, sendAction, followWaiting, lines, inputOf, publish, sendQueued, sendHeld]
  );

  return { send, waiting };
}
