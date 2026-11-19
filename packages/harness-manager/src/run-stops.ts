// FIX-2794.
/**
 * The stops a harness run's step runs under: stopped once its harness has
 * gone silent, and, when the host sets one, at a cap on its run time. The
 * step goes on for as long as its harness keeps sending events (`onEvent`),
 * and is stopped once it has sent nothing for the idle window. A run that is
 * still working is stopped for how long it has run only at the cap: 4 hours
 * by default, which a host raises, or turns off with `0`.
 *
 * Shared by the manager's coding runs and the session flow's turns, which
 * arm it per step, keyed by request, and read back which stop fired, in the
 * words the run ends with.
 */
import { formatRunDuration } from "@flow-state-dev/core/harness";
import type { StepOutcome } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { assertPositiveInt } from "./guards";

/**
 * How long a run may send nothing before it is stopped, when the host names
 * no window. Twenty minutes, because a long tool call inside a harness (a
 * test suite, a build) sends nothing until it returns.
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 20 * 60_000;

/**
 * The cap on a run's total time when the host names none. Four hours: far
 * past any run that is making progress, so it only ends one that loops while
 * still sending events, which the silence window never stops.
 */
const DEFAULT_RUN_CAP_MS = 4 * 60 * 60_000;

/**
 * A host's cap option as the cap the stops run with: unset is the 4-hour
 * default, `0` turns the cap off (`undefined`), and anything else must be a
 * delay a timer honours.
 *
 * @throws When the value is neither `0` nor a positive whole number a timer honours.
 */
export function resolveRunCap(label: string, value: number | undefined): number | undefined {
  if (value === undefined) return DEFAULT_RUN_CAP_MS;
  if (value === 0) return undefined;
  return assertPositiveInt(label, value);
}

/** What a run stopped for silence ends with: `No output from Claude Code for 20 mins; stopped.` */
function idleStopMessage(harness: string, idleTimeoutMs: number): string {
  return `No output from ${harness} for ${formatRunDuration(idleTimeoutMs)}; stopped.`;
}

/** What a run stopped at its cap ends with: `Claude Code ran for 1 hr, its cap on run time; stopped.` */
function capStopMessage(harness: string, capMs: number): string {
  return `${harness.charAt(0).toUpperCase()}${harness.slice(1)} ran for ${formatRunDuration(capMs)}, its cap on run time; stopped.`;
}

/** Which stop fired on a step, and the words its run ends with. */
export interface FiredStop {
  readonly kind: "idle" | "cap";
  readonly message: string;
}

/** One armed step: its stop, its timers, and when its harness last sent something. */
interface Watch {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  capTimer: ReturnType<typeof setTimeout> | undefined;
  heardAt: number;
  /** Whether the step's harness has sent anything since the step started. */
  heard: boolean;
}

/**
 * Each running step's stops, by request. `arm` starts them when the step
 * starts, `heard` restarts the silence window on each event, `clear` lets
 * them go when the step settles, and `takeFired` says, once, which stop
 * fired on the step, with the message it ends with. Only a step that threw
 * keeps that for `takeFired`: one that returned or suspended reaches no
 * rescue, so its stop is forgotten as it settles.
 *
 * A silence stop on a step whose harness never sent a single event warns
 * once, for the host: its harness is likely not handed `onEvent`, so every
 * run is stopped at the window however busy it is.
 *
 * One silence timer per step, not one per event: an event only notes the
 * time (`heardAt`), and the timer, when it fires, measures the silence from
 * that time and, if it is short of the window, waits out what is left.
 *
 * @param idleTimeoutMs The silence window; checked by the caller.
 * @param harness What the harness is called in a person's words, for the messages. Default `"the harness"`.
 * @param capMs The cap on a step's run time, however busy it is; checked by the caller. None by default.
 */
export function runStops(idleTimeoutMs: number, harness: string = "the harness", capMs?: number) {
  const watches = new Map<string, Watch>();
  const fired = new Map<string, FiredStop>();
  const idleMessage = idleStopMessage(harness, idleTimeoutMs);
  const capMessage = capMs === undefined ? undefined : capStopMessage(harness, capMs);
  let warnedNeverHeard = false;

  const stop = (requestId: string, watch: Watch, said: FiredStop): void => {
    clearTimeout(watch.timer);
    clearTimeout(watch.capTimer);
    watches.delete(requestId);
    fired.set(requestId, said);
    watch.controller.abort(new Error(said.message));
  };

  const schedule = (requestId: string, watch: Watch, ms: number): void => {
    watch.timer = setTimeout(() => {
      const silentFor = Date.now() - watch.heardAt;
      if (silentFor < idleTimeoutMs) {
        schedule(requestId, watch, idleTimeoutMs - silentFor);
        return;
      }
      if (!watch.heard && !warnedNeverHeard) {
        warnedNeverHeard = true;
        console.warn(
          `[harness-manager] ${idleMessage} Its harness sent no event at all in that time: if it is not handed the ` +
            "`onEvent` feed, every run is stopped at the window however busy it is.",
        );
      }
      stop(requestId, watch, { kind: "idle", message: idleMessage });
    }, ms);
    // A stop never holds a host's process open on its own.
    watch.timer.unref?.();
  };

  return {
    /** The step's stop: aborts once its harness has sent nothing for the window, or at the cap. */
    arm(ctx: Pick<BlockContext, "request">): AbortSignal {
      const requestId = ctx.request.identity.id;
      const was = watches.get(requestId);
      if (was !== undefined) {
        clearTimeout(was.timer);
        clearTimeout(was.capTimer);
      }
      fired.delete(requestId);
      const watch: Watch = {
        controller: new AbortController(),
        timer: undefined as never,
        capTimer: undefined,
        heardAt: Date.now(),
        heard: false,
      };
      watches.set(requestId, watch);
      schedule(requestId, watch, idleTimeoutMs);
      if (capMs !== undefined && capMessage !== undefined) {
        watch.capTimer = setTimeout(() => stop(requestId, watch, { kind: "cap", message: capMessage }), capMs);
        watch.capTimer.unref?.();
      }
      return watch.controller.signal;
    },
    /** The step's harness sent something: its silence window starts again. */
    heard(ctx: Pick<BlockContext, "request">): void {
      const watch = watches.get(ctx.request.identity.id);
      if (watch === undefined) return;
      watch.heardAt = Date.now();
      watch.heard = true;
    },
    /** The step settled: its timers go, and its stop too unless the step threw, for the rescue to read. */
    clear(ctx: Pick<BlockContext, "request">, outcome: StepOutcome): void {
      const requestId = ctx.request.identity.id;
      if (outcome !== "threw") fired.delete(requestId);
      const watch = watches.get(requestId);
      if (watch === undefined) return;
      clearTimeout(watch.timer);
      clearTimeout(watch.capTimer);
      watches.delete(requestId);
    },
    /** Which stop fired on the request's step, forgetting it; `undefined` when neither did. */
    takeFired(requestId: string): FiredStop | undefined {
      const said = fired.get(requestId);
      fired.delete(requestId);
      return said;
    },
  };
}

/** One host's run stops. */
export type RunStops = ReturnType<typeof runStops>;
