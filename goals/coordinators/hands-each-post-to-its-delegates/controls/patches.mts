/**
 * The goal's three controls, each one scratch patch to one Workforce module,
 * applied as the process under test loads it (`goals/lib/module-patch.mjs`). Nothing is
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
import { describePatches, modulePatchEnv } from "../../../lib/module-patch.mts";

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

/** The environment that applies `control` to a process serving the checkout at `root`. */
export function controlEnv(control: Control, root: string, mark: string): Record<string, string> {
  return modulePatchEnv([{ module: control.module, from: control.from, to: control.to }], root, mark);
}

/** The patch as a reader sees it: the module, the line before and after. */
export function describePatch(control: Control, root: string): string {
  return describePatches([{ module: control.module, from: control.from, to: control.to }], root);
}
