/**
 * The `fsdev chat` read-eval loop. Reads lines (via `node:readline`), routes each
 * through parse → resolveDispatch, and drives built-ins or turns. One turn is in
 * flight at a time (readline yields the next line only after the body settles),
 * so piped stdin is strictly sequential — the test/goal-check seam.
 *
 * Interrupt handling is state-dependent (TTY only). Idle: readline's own SIGINT —
 * first Ctrl-C warns, a second exits. Turn in flight: readline is paused and raw
 * mode dropped (so the terminal generates SIGINT again), and a process-level
 * handler drives the turn's true-abort for the turn's duration. Ctrl-D ends the
 * loop. Piped stdin exercises none of this; it just reads to EOF.
 */
import * as readline from "node:readline";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { RuntimeConfig, StoreRegistry } from "@flow-state-dev/engine";
import { parseInput } from "./parse";
import { resolveDispatch, type FlowActionTarget } from "./targets";
import { type HarnessState, newSessionId } from "./state";
import type { BuiltinCommand, BuiltinContext } from "./registry";
import { executeTurn, type RunningTurn } from "./turn";
import type { ChatRenderer } from "./render";
import { EXIT_SUCCESS, EXIT_EXECUTION_ERROR } from "../exit-codes";

/** Validates that an existing session is safe to bind to `target` (§4.4 guard). */
export type SessionGuard = (
  sessionId: string,
  target: FlowActionTarget,
) => Promise<{ ok: true } | { ok: false; message: string }>;

/** A TTY input stream whose raw mode the loop toggles around a streaming turn. */
type LoopInput = NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (mode: boolean) => void };

export interface ChatLoopParams {
  state: HarnessState;
  /** Resolves a flow instance for a target's kind (registry-default instance). */
  registry: { get(kind: string, id?: string): FlowInstance | undefined };
  targets: FlowActionTarget[];
  builtins: ReadonlyMap<string, BuiltinCommand>;
  renderer: ChatRenderer;
  stores: StoreRegistry;
  runtimeConfig: RuntimeConfig;
  userId: string;
  /** Plain-data runtime snapshot for `/status`. */
  runtime: { source: string; store: string };
  validateSessionForTarget: SessionGuard;
  input: LoopInput;
  output: NodeJS.WritableStream;
  isTTY: boolean;
}

const PROMPT = "❯ ";

/**
 * Decide what an idle Ctrl-C does: the first press warns and arms, a second
 * (while still armed) exits. Pure so the double-press rule is unit-tested even
 * though raw-TTY signal delivery can't be driven through a pipe.
 */
export function decideIdleInterrupt(armed: boolean): { action: "warn" | "exit"; armed: boolean } {
  return armed ? { action: "exit", armed: false } : { action: "warn", armed: true };
}

/** Run the loop to completion; returns the process exit code. */
export async function runChatLoop(params: ChatLoopParams): Promise<number> {
  const {
    state, registry, targets, builtins, renderer, stores, runtimeConfig,
    userId, runtime, validateSessionForTarget, input, output, isTTY,
  } = params;

  const builtinCtx: BuiltinContext = {
    state,
    targets,
    runtime,
    validateSessionForTarget,
    write: (line) => renderer.onSystem(line),
  };

  const rl = readline.createInterface({ input, output, terminal: isTTY });
  let failed = false;
  let currentTurn: RunningTurn | undefined;
  let idleArmed = false;

  const promptIfTty = (): void => {
    if (isTTY) output.write(PROMPT);
  };

  const setRawMode = (mode: boolean): void => {
    if (input.isTTY && typeof input.setRawMode === "function") input.setRawMode(mode);
  };

  // Idle Ctrl-C: readline delivers SIGINT only while it is reading (raw mode on).
  // During a turn we pause it and use a process handler instead, so the two paths
  // never overlap.
  if (isTTY) {
    rl.on("SIGINT", () => {
      const { action, armed } = decideIdleInterrupt(idleArmed);
      idleArmed = armed;
      if (action === "exit") {
        output.write("\n");
        rl.close();
        return;
      }
      output.write("\n(press Ctrl-C again or /exit to quit)\n");
      promptIfTty();
    });
  }

  /** Handle one line; returns true when the loop should stop. */
  const handleLine = async (rawLine: string): Promise<boolean> => {
    idleArmed = false; // any typed line disarms the pending Ctrl-C
    const dispatch = resolveDispatch(parseInput(rawLine), state, builtins);
    switch (dispatch.kind) {
      case "noop":
        if (dispatch.hint !== undefined) renderer.onSystem(dispatch.hint);
        return false;

      case "unbound":
        renderer.onSystem("No default target — pick one with /use <flow> [action] (see /targets).");
        return false;

      case "builtin": {
        const result = await dispatch.command.run(dispatch.args, builtinCtx);
        if (result.ok) return result.exit === true;
        renderer.onSystem(result.message);
        failed = true;
        return false;
      }

      case "turn":
      case "fallthrough": {
        const target = dispatch.kind === "turn" ? dispatch.target : state.defaultTarget!;
        state.turns += 1;
        const sessionId = state.sessions.get(target.flowKind)!;

        // Per-turn guard re-check catches foreign-flow requests appended to this
        // session by another process after bind. On failure: rotate to a fresh id
        // and fail the turn (never execute against the tainted session).
        const verdict = await validateSessionForTarget(sessionId, target);
        if (!verdict.ok) {
          const fresh = newSessionId();
          state.sessions.set(target.flowKind, fresh);
          renderer.onSystem(`${verdict.message} Rotated to a fresh session (${fresh}); resend to continue.`);
          failed = true;
          return false;
        }

        const flow = registry.get(target.flowKind);
        if (flow === undefined) {
          renderer.onSystem(`Flow "${target.flowKind}" is no longer available.`);
          failed = true;
          return false;
        }

        currentTurn = executeTurn({
          flow, target, text: dispatch.text, sessionId, userId, stores, runtimeConfig, renderer,
        });

        // While the turn streams, pause readline and drop raw mode so the terminal
        // generates SIGINT again; a process handler routes Ctrl-C to the true abort.
        let onSigint: (() => void) | undefined;
        if (isTTY) {
          rl.pause();
          setRawMode(false);
          onSigint = () => currentTurn?.requestAbort();
          process.on("SIGINT", onSigint);
        }
        try {
          const result = await currentTurn.done;
          if (result.errored) failed = true;
        } finally {
          if (onSigint !== undefined) process.off("SIGINT", onSigint);
          if (isTTY) {
            setRawMode(true);
            rl.resume();
          }
          currentTurn = undefined;
        }
        return false;
      }
    }
  };

  promptIfTty();
  try {
    for await (const rawLine of rl) {
      const stop = await handleLine(rawLine);
      if (stop) break;
      promptIfTty();
    }
  } finally {
    rl.close();
  }

  // Piped mode surfaces a failing run (a turn error or a failed built-in); a TTY
  // exits success on /exit, Ctrl-D, or the double-Ctrl-C above.
  if (!isTTY && failed) return EXIT_EXECUTION_ERROR;
  return EXIT_SUCCESS;
}
