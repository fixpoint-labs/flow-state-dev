/**
 * Fullscreen loop over conductor actions.
 *
 * I/O only. Keys go through `applyKey`; verbs go through `startConductorAction`
 * so a wake streams the same events `fsdev run conductor wake` would, and the
 * board is re-read through `status` afterwards — that action is the authority.
 */
import type { RequestStreamEventWithId } from "@flow-state-dev/engine";
import {
  abortConductorRequest,
  answerInput,
  seedInput,
  startConductorAction,
  type ConductorDispatch,
} from "./dispatch";
import { applyKey, decodeKeys, rowAfterRefresh, type Key } from "./keys";
import { renderFrame } from "./render";
import {
  applyTranscriptPatch,
  createStreamTranscript,
  diffBoard,
} from "./transcript";
import { createChildFollow } from "./follow";
import {
  clampSelected,
  emptyView,
  pushActivity,
  runningRequestIds,
  selectedRunningRequestId,
  type AnswerOutput,
  type OperatorCommand,
  type SeedOutput,
  type StatusOutput,
  type ViewState,
} from "./types";

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const MOUSE_ON = "\x1b[?1000h\x1b[?1006h";
const MOUSE_OFF = "\x1b[?1000l\x1b[?1006l";
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
      "fsdev conductor: the interactive surface needs a TTY. Use a headless verb (status, seed, wake, answer, watch, abort).\n",
    );
    return 1;
  }

  let state = emptyView(options.epicLabel);
  let pending = "";
  let closed = false;
  let abortInFlight: (() => void) | undefined;
  let refreshSeq = 0;
  let refreshInFlight = false;
  const operatorTranscript = createStreamTranscript();
  const childTranscripts = new Map<string, ReturnType<typeof createStreamTranscript>>();

  const childTranscript = (requestId: string) => {
    let machine = childTranscripts.get(requestId);
    if (machine === undefined) {
      machine = createStreamTranscript();
      childTranscripts.set(requestId, machine);
    }
    return machine;
  };

  const size = () => ({
    cols: output.columns ?? 80,
    rows: output.rows ?? 24,
  });

  const paint = () => {
    if (closed) return;
    output.write(`${HOME}${ERASE}${renderFrame(state, size())}`);
  };

  const applyOperator = (event: RequestStreamEventWithId) => {
    state = applyTranscriptPatch(state, operatorTranscript.apply(event), now());
    paint();
  };

  const applyChild = (event: RequestStreamEventWithId) => {
    const requestId = event.requestId;
    if (typeof requestId !== "string" || requestId === "") {
      applyOperator(event);
      return;
    }
    state = applyTranscriptPatch(state, childTranscript(requestId).apply(event), now(), requestId);
    paint();
  };

  const follow = createChildFollow({
    stores: options.dispatch.stores,
    onEvent: applyChild,
    onEnd: (requestId) => {
      const machine = childTranscripts.get(requestId);
      if (machine === undefined) return;
      state = applyTranscriptPatch(state, machine.flush(), now(), requestId);
      childTranscripts.delete(requestId);
      paint();
    },
  });

  const endTurn = () => {
    state = applyTranscriptPatch(state, operatorTranscript.flush(), now());
    paint();
  };

  const runAction = <T>(action: "seed" | "wake" | "status" | "answer", input: unknown) => {
    const running = startConductorAction<T>(options.dispatch, action, input, applyOperator);
    abortInFlight = running.requestAbort;
    return running.done;
  };

  const refresh = async () => {
    const seq = ++refreshSeq;
    const result = await runAction<StatusOutput>("status", {});
    if (closed || seq !== refreshSeq) return;
    if (result.error !== undefined) throw new Error(result.error);
    state = applyStatus(state, result.output ?? { rows: [] }, now());
    follow.sync(runningRequestIds(state.rows));
    endTurn();
  };

  const dispatchCommand = async (command: OperatorCommand) => {
    state = { ...state, busy: true, notice: null };
    paint();
    try {
      switch (command.kind) {
        case "seed":
        case "start": {
          const seeded = await runAction<SeedOutput>("seed", seedInput(command.issue, command.phase));
          if (seeded.error !== undefined) throw new Error(seeded.error);
          if (seeded.output === undefined) throw new Error("conductor seed returned no task id");
          endTurn();
          state = pushActivity(state, `seeded ${command.issue} → ${seeded.output.taskId}`, now());
          await refresh();
          break;
        }
        case "wake": {
          const result = await runAction<unknown>("wake", {});
          if (result.error !== undefined) throw new Error(result.error);
          endTurn();
          state = pushActivity(state, "wake · drain ran", now());
          await refresh();
          break;
        }
        case "answer": {
          const answered = await runAction<AnswerOutput>(
            "answer",
            answerInput(command.question, command.text),
          );
          if (answered.error !== undefined) throw new Error(answered.error);
          if (answered.output === undefined) throw new Error("conductor answer returned nothing");
          endTurn();
          const label =
            answered.output.result === "declined"
              ? `answer declined · ${answered.output.reason ?? "refused"}`
              : `answer ${answered.output.result}${answered.output.drained ? " · drain ran" : ""}`;
          state = pushActivity(state, label, now());
          state = { ...state, notice: answered.output.result === "declined" ? answered.output.reason : null };
          await refresh();
          break;
        }
        case "abort": {
          const ids =
            command.issue !== undefined
              ? runningRequestIds(
                  state.rows.filter(
                    (row) =>
                      row.issue?.toLowerCase() === command.issue!.toLowerCase() ||
                      row.taskId === command.issue,
                  ),
                )
              : selectedRunningRequestId(state) !== undefined
                ? [selectedRunningRequestId(state)!]
                : [];
          if (ids.length === 0) {
            state = { ...state, notice: "nothing running to stop" };
            break;
          }
          for (const id of ids) {
            const result = await abortConductorRequest(options.dispatch.stores, id);
            state = pushActivity(
              state,
              result === "signaled" ? `stop · ${id}` : `stop · ${id} was not running`,
              now(),
            );
          }
          await refresh();
          break;
        }
        case "watch":
        case "status":
        case "refresh":
          await refresh();
          break;
        case "help":
          state = { ...state, help: true };
          break;
        case "find":
          break;
        case "quit":
          closed = true;
          break;
      }
    } catch (err) {
      endTurn();
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
  output.write(`${ENTER_ALT}${MOUSE_ON}${HIDE_CURSOR}`);
  paint();

  const onResize = () => paint();
  output.on("resize", onResize);

  try {
    await refresh();
    if (options.focusIssue !== undefined) {
      state = rowAfterRefresh(state, options.focusIssue);
      paint();
    }

    await new Promise<void>((resolve) => {
      const poll = setInterval(() => {
        if (closed || state.busy || refreshInFlight) return;
        refreshInFlight = true;
        void refresh()
          .catch((err: unknown) => {
            state = { ...state, notice: err instanceof Error ? err.message : String(err) };
            paint();
          })
          .finally(() => {
            refreshInFlight = false;
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
          void refresh().catch((err: unknown) => {
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
    follow.stop();
    output.off("resize", onResize);
    input.setRawMode?.(wasRaw ?? false);
    input.pause();
    output.write(`${MOUSE_OFF}${SHOW_CURSOR}${LEAVE_ALT}`);
  }
  return 0;
}

export function applyStatus(state: ViewState, output: StatusOutput, at: number): ViewState {
  const previousTaskId = state.rows[state.selected]?.taskId;
  const moved = diffBoard(state.rows, output.rows);
  let next = clampSelected({
    ...state,
    rows: output.rows,
    lastRefreshAt: at,
  });
  next = rowAfterRefresh(next, undefined, previousTaskId);
  for (const line of moved) next = pushActivity(next, line, at);
  return next;
}
