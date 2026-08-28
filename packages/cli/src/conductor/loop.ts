/**
 * Fullscreen loop over conductor actions.
 *
 * I/O only. Keys go through `applyKey`; verbs go through `startConductorAction`
 * so a wake streams the same events `fsdev run conductor wake` would, and the
 * board is re-read through `status` afterwards — that action is the authority.
 */
import type { RequestStreamEventWithId } from "@flow-state-dev/engine";
import {
  activityFromEvent,
  answerQuestion,
  readBoard,
  seedIssue,
  startConductorAction,
  type ConductorDispatch,
} from "./dispatch";
import { applyKey, decodeKeys, rowAfterRefresh, type Key } from "./keys";
import { renderFrame } from "./render";
import {
  clampSelected,
  emptyView,
  pushActivity,
  type OperatorCommand,
  type StatusOutput,
  type ViewState,
} from "./types";

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const HOME = "\x1b[H";
const ERASE = "\x1b[J";
const POLL_MS = 1_000;

export interface LoopOptions {
  dispatch: ConductorDispatch;
  epicLabel: string;
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
  pollMs?: number;
  focusIssue?: string;
  now?: () => number;
}

export async function runConductorTui(options: LoopOptions): Promise<number> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const pollMs = options.pollMs ?? POLL_MS;
  const now = options.now ?? Date.now;
  const isTTY = Boolean(input.isTTY && output.isTTY);

  if (!isTTY) {
    output.write(
      "fsdev conductor: the interactive surface needs a TTY. Use a headless verb (status, seed, wake, answer, watch).\n",
    );
    return 1;
  }

  let state = emptyView(options.epicLabel);
  let pending = "";
  let closed = false;
  let abortInFlight: (() => void) | undefined;

  const size = () => ({
    cols: output.columns ?? 80,
    rows: output.rows ?? 24,
  });

  const paint = () => {
    output.write(`${HOME}${ERASE}${renderFrame(state, size())}`);
  };

  const onEvent = (event: RequestStreamEventWithId) => {
    const line = activityFromEvent(event);
    if (line === undefined) return;
    state = pushActivity(state, line, now());
    paint();
  };

  const refresh = async (note?: string) => {
    const result = await readBoard(options.dispatch, undefined, onEvent);
    state = applyStatus(state, result, now(), options.focusIssue);
    if (note !== undefined) state = pushActivity(state, note, now());
    paint();
  };

  const dispatchCommand = async (command: OperatorCommand) => {
    state = { ...state, busy: true, notice: null };
    paint();
    try {
      switch (command.kind) {
        case "seed":
        case "start": {
          const seeded = await seedIssue(options.dispatch, command.issue, command.phase, onEvent);
          state = pushActivity(state, `seeded ${command.issue} → ${seeded.taskId}`, now());
          await refresh();
          break;
        }
        case "wake": {
          const running = startConductorAction(options.dispatch, "wake", {}, onEvent);
          abortInFlight = running.requestAbort;
          const result = await running.done;
          abortInFlight = undefined;
          if (result.error !== undefined) throw new Error(result.error);
          state = pushActivity(state, "wake · drain ran", now());
          await refresh();
          break;
        }
        case "answer": {
          const answered = await answerQuestion(
            options.dispatch,
            command.question,
            command.text,
            onEvent,
          );
          const label =
            answered.result === "declined"
              ? `answer declined · ${answered.reason ?? "refused"}`
              : `answer ${answered.result}${answered.drained ? " · drain ran" : ""}`;
          state = pushActivity(state, label, now());
          state = { ...state, notice: answered.result === "declined" ? answered.reason : null };
          await refresh();
          break;
        }
        case "watch":
        case "status":
        case "refresh":
          await refresh("status");
          break;
        case "help":
          state = { ...state, help: true };
          break;
        case "quit":
          closed = true;
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state = { ...pushActivity(state, message, now()), notice: message };
    } finally {
      abortInFlight = undefined;
      state = { ...state, busy: false };
      paint();
    }
  };

  const wasRaw = input.isRaw;
  input.setRawMode?.(true);
  input.resume();
  output.write(`${ENTER_ALT}${HIDE_CURSOR}`);
  paint();

  const onResize = () => paint();
  output.on("resize", onResize);

  try {
    await refresh("board");
    if (options.focusIssue !== undefined) {
      state = rowAfterRefresh(state, options.focusIssue);
      paint();
    }

    await new Promise<void>((resolve) => {
      const poll = setInterval(() => {
        if (closed || state.busy) return;
        void refresh().catch((err: unknown) => {
          state = { ...state, notice: err instanceof Error ? err.message : String(err) };
          paint();
        });
      }, pollMs);

      const finish = () => {
        clearInterval(poll);
        input.off("data", onData);
        process.off("SIGINT", onSigint);
        resolve();
      };

      const handleKey = (key: Key) => {
        if (state.busy && key.type === "ctrl" && key.value === "c") {
          abortInFlight?.();
          state = pushActivity(state, "abort requested", now());
          paint();
          return;
        }
        const result = applyKey(state, key);
        state = result.state;
        if (result.effect === undefined) {
          paint();
          return;
        }
        if (result.effect.type === "quit") {
          closed = true;
          finish();
          return;
        }
        if (result.effect.type === "refresh") {
          void refresh("refresh").catch((err: unknown) => {
            state = { ...state, notice: err instanceof Error ? err.message : String(err) };
            paint();
          });
          return;
        }
        void dispatchCommand(result.effect.command).then(() => {
          if (closed) finish();
        });
      };

      const onData = (buf: Buffer | string) => {
        if (closed) return;
        const chunk = typeof buf === "string" ? buf : buf.toString("utf8");
        const decoded = decodeKeys(chunk, pending);
        pending = decoded.rest;
        for (const key of decoded.keys) {
          handleKey(key);
          if (closed) break;
        }
      };

      const onSigint = () => {
        if (state.busy) {
          abortInFlight?.();
          return;
        }
        closed = true;
        finish();
      };

      input.on("data", onData);
      process.on("SIGINT", onSigint);
    });
  } finally {
    output.off("resize", onResize);
    input.setRawMode?.(wasRaw ?? false);
    input.pause();
    output.write(`${SHOW_CURSOR}${LEAVE_ALT}`);
  }
  return 0;
}

export function applyStatus(
  state: ViewState,
  output: StatusOutput,
  at: number,
  preferIssue?: string,
): ViewState {
  const next = clampSelected({
    ...state,
    rows: output.rows,
    lastRefreshAt: at,
  });
  return rowAfterRefresh(next, preferIssue);
}
