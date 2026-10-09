/**
 * The goal's three controls, each one scratch patch to one Workforce module,
 * applied as the process under test loads it (`module-patch.mjs`). Nothing is
 * written to the checkout, and nothing here is committed code.
 *
 * - `no-roster-check`: the delegate check takes a worker that isn't on the
 *   conversation's user's roster as if it were, so Bob's worker can join
 *   Alice's delegates. Leg f must fail on *Bob's worker is a delegate*.
 * - `no-round-limit`: a coordinator whose `rounds:` is above 0 runs to the
 *   ceiling of 3 whatever it set. Leg e must fail on *four answers, then
 *   none*. A coordinator at `rounds: 0` is untouched, so the patch says
 *   nothing about best fit and round robin.
 * - `no-delegate-read`: the coordinator's delegate read answers from the
 *   worker's defaults, not the conversation's list. Leg d must fail on *the
 *   reply equals the list*.
 *
 * Each patch's anchor is a line that reads the same in the TypeScript source
 * and in tsx's JavaScript output; the hook throws when it matches nothing,
 * and marks a file when it applied, so a control that never reached the
 * served code fails the run instead of passing on it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The controls this goal understands. */
export const CONTROL_NAMES = ["no-roster-check", "no-round-limit", "no-delegate-read"] as const;

export type ControlName = (typeof CONTROL_NAMES)[number];

/** One control: the leg it must fail, the assertion, and its patch. */
export interface Control {
  name: ControlName;
  /** The leg it runs and must fail. */
  leg: "d" | "e" | "f";
  /** The assertion, by name, that must go red. */
  assertion: string;
  /** The module, from the checkout root. */
  module: string;
  from: string;
  to: string;
  /** What the patch does, in a line. */
  does: string;
}

export const CONTROLS: Record<ControlName, Control> = {
  "no-roster-check": {
    name: "no-roster-check",
    leg: "f",
    assertion: "f:bobs-worker-refused",
    module: "packages/workforce/src/coordinator/coordinator-check.ts",
    from: String.raw`if \(worker === (?:undefined|void 0)\) return \{ ok: false,`,
    to: 'if (worker === undefined) return { ok: true, worker: { id: workerId, flow: "agent", description: null }, takesPost: true,',
    does: "a worker not on the conversation's user's roster passes the delegate check as if it were one of theirs on `agent`",
  },
  "no-round-limit": {
    name: "no-round-limit",
    leg: "e",
    assertion: "e:four-then-none",
    module: "packages/workforce/src/coordinator/coordinator-flow.ts",
    from: String.raw`const config = worker\.config(?: as unknown as CoordinatorConfig)?;`,
    to: "const config = { ...worker.config, rounds: worker.config.rounds > 0 ? 3 : 0 };",
    does: "a coordinator whose `rounds:` is above 0 runs to the ceiling of 3 rounds, whatever it set",
  },
  "no-delegate-read": {
    name: "no-delegate-read",
    leg: "d",
    assertion: "d:reply-equals-list",
    module: "packages/workforce/src/coordinator/coordinator-flow.ts",
    from: String.raw`list: await readDelegates\(ctx\.session, defaults\)`,
    to: "list: { delegates: defaults.delegates.map((worker) => ({ worker })), fallback: defaults.fallback === undefined ? null : { worker: defaults.fallback } }",
    does: "the delegate read (the `listDelegates` action and tool) answers from the worker's defaults, not this conversation's list",
  },
};

const MODULE_PATCH = fileURLToPath(new URL("./module-patch.mjs", import.meta.url));

/**
 * The environment that applies `control` to a process serving the checkout
 * at `root`, appending the patched file to `mark` when it loads.
 *
 * @throws When the module at the checkout has nothing the patch's anchor
 *   matches: the control would not apply.
 */
export function controlEnv(control: Control, root: string, mark: string): Record<string, string> {
  const file = join(root, control.module);
  const source = readFileSync(file, "utf8");
  if (!new RegExp(control.from).test(source)) {
    throw new Error(`control ${control.name}: ${control.module} has nothing matching /${control.from}/ to patch`);
  }
  return {
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${pathToFileURL(MODULE_PATCH).href}`.trim(),
    GOAL_MODULE_PATCH: JSON.stringify({ file, from: control.from, to: control.to, mark }),
  };
}

/** The patch as a reader sees it: the module, the line before and after. */
export function describePatch(control: Control, root: string): string {
  const file = join(root, control.module);
  const before = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => new RegExp(control.from).test(line));
  const after = before.map((line) => line.replace(new RegExp(control.from), control.to));
  return [`--- a/${control.module}`, `+++ b/${control.module}`, ...before.map((l) => `-${l}`), ...after.map((l) => `+${l}`)].join("\n");
}
