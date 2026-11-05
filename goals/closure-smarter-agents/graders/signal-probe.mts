/**
 * The signal path of `planted`, for `graders/run.mts`: plant one file, start
 * a detached process the way a served app is started, print its pid, and
 * wait. The check sends this script SIGTERM and then reads whether the file
 * was put back and the process group was stopped.
 *
 * Run by `graders/run.mts` only: `tsx signal-probe.mts <file to plant>`.
 */
import { spawn } from "node:child_process";
import { planted, servedUntilStopped } from "../closure.mts";

const target = process.argv[2]!;
await planted(`signal-probe-${process.pid}`, () => ({ [target]: "planted\n" }), async () => {
  const child = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
  servedUntilStopped(child);
  console.log(`pid ${child.pid}`);
  await new Promise(() => undefined);
});
