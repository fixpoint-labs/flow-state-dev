/**
 * The PATH `conductor` bin is a wrapper. The TUI is the child. A signal
 * on the wrapper must stop that child; the child's exit is the wrapper's
 * exit. Grok is one process. This is the closest we can get without exec.
 */

/** Signals a person or the shell send to stop the board. */
export const CONDUCTOR_CHILD_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

/**
 * The spawned TUI. Only the fields the wrapper reads.
 *
 * @typedef {object} ConductorChild
 * @property {boolean} killed
 * @property {(signal?: string) => boolean} kill
 * @property {(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void) => unknown} on
 */

/**
 * Forward stop signals to `child`, then exit the wrapper the way the
 * child did. Removes the listeners when the child exits so a re-raise
 * cannot loop.
 *
 * @param {ConductorChild} child
 * @param {NodeJS.Process} [proc]
 */
export function attachConductorChild(child, proc = process) {
  /** @type {Array<[string, () => void]>} */
  const attached = [];
  for (const signal of CONDUCTOR_CHILD_SIGNALS) {
    const onSignal = () => {
      if (!child.killed) child.kill(signal);
    };
    proc.on(signal, onSignal);
    attached.push([signal, onSignal]);
  }
  child.on("exit", (code, signal) => {
    for (const [name, onSignal] of attached) {
      proc.off(name, onSignal);
    }
    if (signal) {
      proc.kill(proc.pid, signal);
      return;
    }
    proc.exit(code ?? 1);
  });
}
