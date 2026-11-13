/**
 * The goal checks' controls on `support.help`, the coordinator (`GOAL_CONTROL`).
 *
 * - `no-route` serves a copy of the workforce folder in which every
 *   coordinator on `routing: best-fit` says `routing: everyone`, so every
 *   delegate hears every post. A check that one specialist answers and nobody
 *   else runs must FAIL under it.
 * - `answers-go-on` serves a copy in which every coordinator says `rounds: 1`,
 *   so each answer goes back out to the other delegates. A check that an
 *   answer wakes nobody must FAIL under it.
 * - `no-delivery` registers the `agent` flow as one whose workers take no
 *   task, so the delegate check refuses every specialist and a message
 *   reaches nobody. A check that the routed specialist runs must FAIL under
 *   it.
 *
 * Each changes what the app hands the package, never the package: the folder
 * the workforce kit reads (a copy, the app's own left as it is), or the flows
 * it fills.
 *
 * Honoured only under `KITCHEN_SINK_TEST_MODE=1` (`goalControl`), so a control
 * can never reach a deployed build.
 */
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workerFlow, type WorkerFlowBuilder, type WorkerInstallation } from "@flow-state-dev/workforce";

import { goalControl } from "./goal-control";

/** A `WORKER.md`'s frontmatter and body, split at its closing `---`. */
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

/**
 * The workforce folder the app serves: `root` itself, or under `no-route` and
 * `answers-go-on` a copy of it with every coordinator's file changed.
 */
export function workforceFolderUnderControl(root: string): string {
  const control = goalControl();
  if (control !== "no-route" && control !== "answers-go-on") return root;
  const copy = join(mkdtempSync(join(tmpdir(), "kitchen-sink-workforce-")), "workforce");
  cpSync(root, copy, { recursive: true });
  for (const team of readdirSync(join(copy, "teams"))) {
    for (const worker of readdirSync(join(copy, "teams", team, "workers"))) {
      const file = join(copy, "teams", team, "workers", worker, "WORKER.md");
      const text = readFileSync(file, "utf8");
      const front = FRONTMATTER.exec(text)?.[1];
      if (front === undefined || !/^flow: coordinator$/m.test(front)) continue;
      const changed =
        control === "answers-go-on"
          ? `${front.replace(/^rounds:.*\n?/m, "")}\nrounds: 1`
          : front.replace(/^routing: best-fit$/m, "routing: everyone");
      writeFileSync(file, text.replace(front, changed));
    }
  }
  return copy;
}

/**
 * Under `no-delivery`, the `agent` flow built by `build`, registered as one
 * whose workers take no task; otherwise `undefined`, and the kit builds its own.
 */
export function agentFlowUnderControl<T extends object>(build: (installation: WorkerInstallation) => T): WorkerFlowBuilder | undefined {
  if (goalControl() !== "no-delivery") return undefined;
  return workerFlow(
    (installation) => {
      const agent = build(installation);
      const mint = (...args: unknown[]) => (agent as unknown as (...a: unknown[]) => unknown)(...args);
      return Object.assign(mint, agent, { task: { actions: {} } });
    },
    { roles: ["manager"] },
  );
}
