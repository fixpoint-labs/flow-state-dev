/**
 * The goal's six controls, each one scratch patch to one Workforce module,
 * applied as the process under test loads it (`goals/lib/module-patch.mjs`).
 * Nothing is written to the checkout, and nothing here is committed code.
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
 * - `no-self-choice`: best fit never offers the coordinator itself. Leg h
 *   must fail on *a hire reaches the chief of staff's own turn*: the EM, its
 *   one choice, is picked at full confidence.
 * - `no-floor`: a delegate pick below `minConfidence:` is used. Leg e must
 *   fail on *a pick below the floor goes to the fallback*, and nothing else:
 *   a pick with no confidence is still a miss.
 * - `turn-after-route`: the coordinator's own turn also runs on a post best
 *   fit placed. Leg a must fail on *no chief-of-staff turn on the post*.
 *
 * Each patch's anchor is a line that reads the same in the TypeScript source
 * and in tsx's JavaScript output; the hook throws when it matches nothing,
 * and marks a file when it applied, so a control that never reached the
 * served code fails the run instead of passing on it.
 */
import { describePatches, modulePatchEnv } from "../../../lib/module-patch.mts";

/** The controls this goal understands. */
export const CONTROL_NAMES = [
  "no-roster-check",
  "no-round-limit",
  "no-delegate-read",
  "no-self-choice",
  "no-floor",
  "turn-after-route",
] as const;

export type ControlName = (typeof CONTROL_NAMES)[number];

/** One control: the leg it must fail, the assertion, and its patch. */
export interface Control {
  name: ControlName;
  /** The leg it runs and must fail. */
  leg: "a" | "d" | "e" | "f" | "h";
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
  "no-self-choice": {
    name: "no-self-choice",
    leg: "h",
    assertion: "h:hire-turn",
    module: "packages/workforce/src/coordinator/coordinator-flow.ts",
    from: String.raw`const offersSelf = post\.round === 0 && worker\.description !== null;`,
    to: "const offersSelf = false;",
    does: "best fit never offers the coordinator itself as a choice: its delegates are the only choices",
  },
  "no-floor": {
    name: "no-floor",
    leg: "e",
    assertion: "e:below-floor",
    module: "packages/workforce/src/best-fit.ts",
    from: String.raw`outcome\.confidence < floor\)`,
    to: "false)",
    does: "a delegate pick below the coordinator's `minConfidence:` is used; a pick with no confidence is still a miss",
  },
  "turn-after-route": {
    name: "turn-after-route",
    leg: "a",
    assertion: "a:no-turn",
    module: "packages/workforce/src/coordinator/coordinator-flow.ts",
    from: String.raw`\.step\(decideBestFit\)\s*\.step\(afterPlace\);`,
    to: ".step(decideBestFit).step(afterPlace).step(judgmentAfterBestFit);",
    does: "after best fit places a post, the coordinator's own turn runs on it too, as it did before best fit routed it",
  },
};

/**
 * The environment that applies `control` to a process serving the checkout
 * at `root`, appending the patched file to `mark` when it loads.
 *
 * @throws When the module at the checkout has nothing the patch's anchor
 *   matches: the control would not apply.
 */
export function controlEnv(control: Control, root: string, mark: string): Record<string, string> {
  try {
    return modulePatchEnv([{ module: control.module, from: control.from, to: control.to }], root, mark);
  } catch (error) {
    throw new Error(`control ${control.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The patch as a reader sees it: the module, the line before and after. */
export function describePatch(control: Control, root: string): string {
  return describePatches([{ module: control.module, from: control.from, to: control.to }], root);
}
