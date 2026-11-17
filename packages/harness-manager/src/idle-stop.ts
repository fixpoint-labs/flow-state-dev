// FIX-2794.
/**
 * Stopping a harness run that has gone silent: the run's step goes on for as
 * long as its harness keeps sending events (`onEvent`), and is stopped once
 * it has sent nothing for the idle window. A run that is still working is
 * never stopped for how long it has run; that cap is a host's own option,
 * off by default.
 *
 * Shared by the manager's coding runs and the session flow's turns, which
 * arm it per step, keyed by request.
 */
import { formatRunDuration } from "@flow-state-dev/core/harness";
import type { StepOutcome } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";

/**
 * How long a run may send nothing before it is stopped, when the host names
 * no window. Twenty minutes, because a long tool call inside a harness (a
 * test suite, a build) sends nothing until it returns.
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 20 * 60_000;

/** What a run stopped for silence ends with: `No output from Claude Code for 20 mins; stopped.` */
function idleStopMessage(harness: string, idleTimeoutMs: number): string {
  return `No output from ${harness} for ${formatRunDuration(idleTimeoutMs)}; stopped.`;
}

/** One armed step: its stop, its timer, and when its harness last sent something. */
interface Watch {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  heardAt: number;
  /** Whether the step's harness has sent anything since the step started. */
  heard: boolean;
}

/**
 * Each running step's silence stop, by request. `arm` starts the window when
 * the step starts, `heard` restarts it on each event, `clear` lets it go when
 * the step settles, and `takeFired` says, once, whether the step was stopped
 * for silence, with the message it ends with. Only a step that threw keeps
 * that for `takeFired`: one that returned or suspended reaches no rescue, so
 * its stop is forgotten as it settles.
 *
 * A stop on a step whose harness never sent a single event warns once, for
 * the host: its harness is likely not handed `onEvent`, so every run is
 * stopped at the window however busy it is.
 *
 * One timer per step, not one per event: an event only notes the time
 * (`heardAt`), and the timer, when it fires, measures the silence from that
 * time and, if it is short of the window, waits out what is left.
 *
 * @param idleTimeoutMs The window; checked by the caller.
 * @param harness What the harness is called in a person's words, for the message. Default `"the harness"`.
 */
export function idleStops(idleTimeoutMs: number, harness: string = "the harness") {
  const watches = new Map<string, Watch>();
  const fired = new Map<string, string>();
  const message = idleStopMessage(harness, idleTimeoutMs);
  let warnedNeverHeard = false;

  const schedule = (requestId: string, watch: Watch, ms: number): void => {
    watch.timer = setTimeout(() => {
      const silentFor = Date.now() - watch.heardAt;
      if (silentFor < idleTimeoutMs) {
        schedule(requestId, watch, idleTimeoutMs - silentFor);
        return;
      }
      watches.delete(requestId);
      fired.set(requestId, message);
      if (!watch.heard && !warnedNeverHeard) {
        warnedNeverHeard = true;
        console.warn(
          `[harness-manager] ${message} Its harness sent no event at all in that time: if it is not handed the ` +
            "`onEvent` feed, every run is stopped at the window however busy it is.",
        );
      }
      watch.controller.abort(new Error(message));
    }, ms);
    // A silence stop never holds a host's process open on its own.
    watch.timer.unref?.();
  };

  return {
    idleTimeoutMs,
    /** The step's silence stop: aborts once the step's harness has sent nothing for the window. */
    arm(ctx: Pick<BlockContext, "request">): AbortSignal {
      const requestId = ctx.request.identity.id;
      const was = watches.get(requestId);
      if (was !== undefined) clearTimeout(was.timer);
      fired.delete(requestId);
      const watch: Watch = { controller: new AbortController(), timer: undefined as never, heardAt: Date.now(), heard: false };
      watches.set(requestId, watch);
      schedule(requestId, watch, idleTimeoutMs);
      return watch.controller.signal;
    },
    /** The step's harness sent something: its window starts again. */
    heard(ctx: Pick<BlockContext, "request">): void {
      const watch = watches.get(ctx.request.identity.id);
      if (watch === undefined) return;
      watch.heardAt = Date.now();
      watch.heard = true;
    },
    /** The step settled: its timer goes, and its stop too unless the step threw, for the rescue to read. */
    clear(ctx: Pick<BlockContext, "request">, outcome: StepOutcome): void {
      const requestId = ctx.request.identity.id;
      if (outcome !== "threw") fired.delete(requestId);
      const watch = watches.get(requestId);
      if (watch === undefined) return;
      clearTimeout(watch.timer);
      watches.delete(requestId);
    },
    /** The message the request's step was stopped for silence with, forgetting it; `undefined` when it wasn't. */
    takeFired(requestId: string): string | undefined {
      const said = fired.get(requestId);
      fired.delete(requestId);
      return said;
    },
  };
}

/** One host's silence stops. */
export type IdleStops = ReturnType<typeof idleStops>;
