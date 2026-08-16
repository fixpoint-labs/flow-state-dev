/**
 * Asking the operating system whether a process is gone.
 *
 * Conductor kills what it started, and a kill is asynchronous: the signal is
 * delivered, and the process exits some time afterwards. Nothing conductor
 * returns says whether that happened, so the only honest assertion is the one
 * the process table answers.
 */

/**
 * Whether a process is gone, polled briefly.
 *
 * `kill(pid, 0)` sends no signal and answers whether the process exists; a kill
 * is asynchronous, so this waits a moment for it rather than sampling once.
 *
 * @param pid The process to wait on.
 * @returns `true` once the process is gone, `false` if it outlasted the poll.
 */
export async function stopped(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}
