/**
 * Running a real-path harness inside a sibling app.
 *
 * Some goals need code that resolves BOTH an app's `@/*` aliases and its
 * `@flow-state-dev/*` / `@ai-sdk/*` node_modules — which only holds for a file
 * executed with that app as cwd. `goals/` can't do that itself, so the goal
 * ships a sibling `harness.mts` that DRIVES the real path and reports raw
 * observations on one marker line; the runner owns the grading.
 *
 * Two mechanisms had grown for this, and each got one half right:
 *
 *   - The three `suspension` goals built the driver as a TEMPLATE LITERAL and
 *     wrote it to a transient `.goal-*.mts` inside the app. Running a real file
 *     means tsx loads it as ESM — top-level await works, which matters because
 *     kitchen-sink's `flowstate` import chain uses it. But the source was a
 *     string: no typecheck, no highlighting, and escaping like `\\"`.
 *   - `response-auditor` and `webhook-transport` kept a real `harness.mts` and
 *     fed its SOURCE to `tsx -e`. Real file, no escaping — but `tsx -e`
 *     compiles to CJS, so top-level await anywhere in the import graph is a
 *     hard error. Those two only work because their harnesses wrap everything
 *     in `async function main()` and import no app module that awaits at the
 *     top level.
 *
 * This takes both halves: a real checked-in `harness.mts`, COPIED into the app
 * under a transient name and run by path so it loads as ESM. The copy is
 * removed afterwards.
 *
 * Because the copy lands in the app ROOT, a harness's relative imports resolve
 * against the app (`./lib/flowstate`, `./flows/chat-agent/flow`) — the same as
 * the transient drivers this replaces.
 *
 * The harness cannot import this module (it executes from the app, with its own
 * resolution), so it prints the marker literal itself. Keep the two in sync —
 * {@link GOAL_MARKER} is the definition.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { intentFreeEnv } from "./env.mts";

/**
 * The line prefix a harness prints its JSON observations on. Harnesses emit it
 * literally: `console.log("__GOAL__" + JSON.stringify(observations))`.
 */
export const GOAL_MARKER = "__GOAL__";

/** Options for {@link runHarness}. */
export interface RunHarnessOptions {
  /** cwd for the child — the app whose node_modules resolve the harness's imports. */
  app: string;
  /** The harness module's URL, normally `new URL("./harness.mts", import.meta.url)`. */
  harness: URL | string;
  /** Env for the child. Intent-ladder overrides are stripped unless `keepIntents`. */
  env?: Record<string, string>;
  /**
   * Keep `FSDEV_DEFAULT_MODEL` / `FSDEV_INTENT_*`. Default false: a harness that
   * builds its own bare resolver throws if they're set. Set true only when the
   * harness deliberately runs on the app's configured ladder.
   */
  keepIntents?: boolean;
}

/** A harness ran but printed no marker line, or exited non-zero. */
export class HarnessError extends Error {}

/**
 * Execute a harness inside `app` and return the parsed observations from its
 * marker line. Throws {@link HarnessError} on a non-zero exit or a missing
 * marker — `runGoal` turns that into a FAIL with the child's output attached.
 */
export function runHarness<T>(options: RunHarnessOptions): T {
  const harnessPath =
    typeof options.harness === "string" ? options.harness : fileURLToPath(options.harness);
  // Transient copy in the app root: `.` prefix keeps it out of globs, the pid
  // keeps concurrent goals from colliding, and `.mts` makes tsx load it as ESM.
  const transientName = `.goal-${basename(harnessPath, ".mts")}.${process.pid}.mts`;
  const transientPath = join(options.app, transientName);

  const env = options.keepIntents === true
    ? { ...(process.env as Record<string, string>), ...(options.env ?? {}) }
    : intentFreeEnv(process.env, options.env ?? {});

  let stdout: string;
  try {
    copyFileSync(harnessPath, transientPath);
    stdout = execFileSync("pnpm", ["tsx", transientName], {
      cwd: options.app,
      encoding: "utf8",
      env,
      // stderr passes through so a harness's own diagnostics stay visible.
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    throw new HarnessError(
      `harness exited non-zero:\n${e.stdout ?? ""}\n${e.stderr ?? e.message ?? ""}`,
    );
  } finally {
    rmSync(transientPath, { force: true });
  }

  const line = stdout.split("\n").find((l) => l.startsWith(GOAL_MARKER));
  if (line === undefined) {
    throw new HarnessError(`harness produced no ${GOAL_MARKER} line. stdout:\n${stdout}`);
  }
  return JSON.parse(line.slice(GOAL_MARKER.length)) as T;
}
