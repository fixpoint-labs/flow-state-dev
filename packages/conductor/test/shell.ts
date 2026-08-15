/**
 * What a real shell splits a rendered command line into.
 *
 * Conductor renders an argv for a person to read and, in the brief, for an agent
 * to run — while it spawns that argv itself with `shell: false`. Nothing on the
 * TypeScript side can tell whether the two agree, because the disagreement only
 * exists once a shell has parsed the string. So the assertion is made by asking
 * one: `printf` receives the rendered line as its arguments and hands each back
 * NUL-separated, which round-trips an element containing anything at all —
 * spaces, quotes, metacharacters, even a newline.
 *
 * `sh` rather than `bash`: the quoting conductor emits is POSIX, and holding the
 * test to the smaller shell is what keeps it that way.
 */

import { spawn } from "node:child_process";

/** Split a rendered command line the way a shell would when running it. */
export function shellWords(line: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", `printf '%s\\0' ${line}`]);
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", () => {
      // `printf` writes a trailing NUL after the last argument, so the split
      // always ends in an empty string that is a separator and not a word.
      const words = stdout.split("\0");
      words.pop();
      resolve(words);
    });
  });
}
