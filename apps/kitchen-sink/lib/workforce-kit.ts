/**
 * Kitchen-sink's workforce, installed as a kit from its own files.
 *
 * The point of this module is what it does *not* contain: no worker is named
 * here, and no block is. `blocks` comes from `workforce.gen.ts`, which
 * `fsdev gen` writes from the `workforce/` tree, and the workers come from
 * the `teams/` folders: one coordinator, `support.help`, and four specialists
 * on the built-in `agent` flow. Adding a tool means adding a file and
 * re-running the command — there is no second place to edit.
 *
 * Every worker is a standard worker: every user has it, and it runs on one
 * registered copy of its flow. A user's own workers, hired or forked through
 * the roster flow, run on the same copies.
 *
 * This module and the `workforce/` tree are the whole of the app's Layer 2
 * usage. Nothing in `app/` reaches into them. It sits outside `workforce/`:
 * that folder holds only the files workforce reads, and every one of them is
 * used or the app refuses to start, naming it. One edge leads in:
 * `fsdev.config.ts` lists the kit in `createFlowState({ kits })`. That edge is
 * what makes the demonstration real: it is what makes the bundler resolve
 * `workforce.gen.ts`'s imports, so a generated module of static imports is
 * proven to survive a production build (FIX-1429).
 *
 * `support.help` is a coordinator on `routing: best-fit`: each post from a
 * user reaches the one specialist whose `description:` fits it (one
 * evaluator call on `ROUTE_MODEL`), and that specialist's answer lands in the
 * user's conversation with the coordinator under its name.
 */
import { defineAgentWorkerFlow, type WorkerInstallation } from "@flow-state-dev/workforce";
import { workforce } from "@flow-state-dev/workforce/kit";
import type { KitInstance } from "@flow-state-dev/core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { agentFlowUnderControl, workforceFolderUnderControl } from "./coordinator-control";
import { landingControl } from "./landing-control";
import { ROUTE_MODEL } from "./models";
import * as generated from "../workforce/workforce.gen";

/** The app's workforce folder. */
export const workforceRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "workforce");

/**
 * The workforce kit, as the app installs it. Under a goal check's control
 * (test mode only), the folder is a changed copy or the `agent` flow is
 * swapped; otherwise the kit builds the built-in `agent`, carrying the tool
 * catalog, and the coordinator, which routes on `ROUTE_MODEL` and judges on
 * the same catalog.
 */
export function kitchenSinkWorkforce(): KitInstance {
  const { blocks } = generated;
  const agent =
    landingControl(blocks) ?? agentFlowUnderControl((installation: WorkerInstallation) => defineAgentWorkerFlow({ installation, catalog: blocks }));
  return workforce({
    directory: workforceFolderUnderControl(workforceRoot),
    generated: { ...generated, workerFlows: { ...generated.workerFlows, ...(agent === undefined ? {} : { agent }) } },
    ...(agent === undefined ? { agent: { catalog: blocks } } : {}),
    // `support.help` runs on it: its delegates take its routed tasks on `agent`, and best fit's one
    // evaluator call runs on ROUTE_MODEL. Its judgment turn is the agent's own, from the same catalog.
    coordinator: { routeModel: ROUTE_MODEL, agent: { catalog: blocks } },
  });
}
