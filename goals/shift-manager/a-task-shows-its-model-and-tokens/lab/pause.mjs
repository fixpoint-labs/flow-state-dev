/**
 * A pause a scripted SDK waits on and the check releases, across processes:
 * the run writes `PAUSED <run> <n>` to the run log and waits until the file
 * `<releases>/<run>-<n>` exists (the check writes it), or its signal aborts,
 * or two minutes pass.
 */
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export async function pause(setup, run, n, signal) {
  appendFileSync(setup.log, `PAUSED ${run} ${n}\n`);
  const release = join(setup.releases, `${run}-${n}`);
  for (const until = Date.now() + 120_000; Date.now() < until; ) {
    if (existsSync(release)) return;
    if (signal?.aborted === true) throw new Error("the run was stopped");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`pause ${run} ${n} was never released`);
}
