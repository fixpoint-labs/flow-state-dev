/**
 * Kitchen-sink's workforce, assembled from its own files.
 *
 * The point of this module is what it does *not* contain: no worker is named
 * here, and no block is. `blocks` comes from `workforce.gen.ts`, which
 * `fsdev gen` writes from the tree beside this file, and the workers come from
 * the `teams/` folders: one coordinator, `support.help`, and four specialists
 * on the built-in `agent` flow. Adding a tool means adding a file and
 * re-running the command — there is no second place to edit.
 *
 * Every worker is a standard worker: every user has it, and it runs on one
 * registered copy of its flow. A user's own workers, hired or forked through
 * the roster flow, run on the same copies.
 *
 * This subtree is the whole of the app's Layer 2 usage. Nothing in `app/`
 * reaches into it. One edge leads in: `fsdev.config.ts`, which awaits the
 * build below and spreads the copies into the map it serves. That edge is what
 * makes the demonstration real — until it existed the bundler never resolved
 * `workforce.gen.ts`'s imports, so the claim this tree exists to prove (a
 * generated module of static imports survives a production build) was asserted
 * and untested (FIX-1429).
 *
 * `support.help` is a coordinator on `routing: best-fit`: each post from a
 * person reaches the one specialist whose `description:` fits it (one
 * evaluator call on `ROUTE_MODEL`), and that specialist's answer lands in the
 * person's conversation with the coordinator under its name.
 */
import {
  COORDINATOR_KIND,
  createWorkerInstallation,
  defineAgentWorkerFlow,
  defineCoordinatorFlow,
  hireWorkforce,
  type WorkerInstallation,
} from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { coordinatorWorkersUnderControl, delegateFlowsUnderControl } from "../lib/coordinator-control";
import { landingControl } from "../lib/landing-control";
import { ROUTE_MODEL } from "../lib/models";
import { blocks, kinds, packageBlocks, seatBlocks } from "./workforce.gen";

/** This directory — the workforce root, read at run time the way Markdown always is. */
export const workforceRoot = dirname(fileURLToPath(import.meta.url));

/** The installation, the copies it registers, and what the loader could not read. */
export interface KitchenSinkWorkforce {
  /** The worker model: the standard workers, and the checks every session of a worker flow meets. */
  installation: WorkerInstallation;
  /** One copy per worker flow (`agent` and `coordinator` among them), and the roster flow. Register these. */
  copies: FlowInstance[];
  /**
   * Everything the loader could not read, by path — from **all three** of its
   * error channels, not just the worker one. A worker folder that failed is a
   * worker this app does not have, a skill that failed is a worker running
   * short, and a `TEAM.md` that failed is a whole team running without the
   * instructions its author wrote. This app's answer to all three is the same:
   * say so.
   *
   * **A package that failed to load is NOT here.** It throws instead: a worker
   * short a package runs without the instructions and tools its author gave it.
   */
  errors: string[];
}

/**
 * Read the team's files and build the workforce they describe.
 *
 * @returns The installation, its copies, and any folder the loader reported.
 * @throws If a package fails to load, or a worker flow or a worker is refused.
 */
export async function buildKitchenSinkWorkforce(): Promise<KitchenSinkWorkforce> {
  const read = await readWorkforce(workforceRoot);
  const { errors, skillErrors, teamErrors, packageErrors } = read;
  // The goal checks' route and rounds controls change a coordinator's
  // settings here, before anything is built, in test mode only.
  const workers = coordinatorWorkersUnderControl(read.workers);

  if (packageErrors.length > 0) {
    throw new Error(
      `packages: ${packageErrors.length} package problem(s)\n` +
        packageErrors.map(({ path, error }) => `  ${path}: ${error.message}`).join("\n"),
    );
  }

  // `seatBlocks` registers what each worker's own folder holds, for that
  // worker alone. It grants nothing: a worker still names the block in its
  // `tools:` before the model can call it. `packageBlocks` carries every
  // package's blocks by folder; a worker gets the ones of the packages it holds.
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: workers,
    workerFlows: () => flows as never,
    seatBlocks,
    packageBlocks,
  });
  // The built-in `agent`, carrying the tool catalog, takes the coordinator's
  // posts. The goal check's `no-landing` control swaps it for one that takes a
  // post and hands no answer back, in test mode only.
  const agent = landingControl(blocks, installation) ?? defineAgentWorkerFlow({ installation, catalog: blocks });
  flows = {
    ...kinds,
    agent,
    // The coordinator flow: `support.help` runs on it. Its delegates take
    // posts on `agent`, and best fit's one evaluator call runs on ROUTE_MODEL.
    // Its judgment turn, for a post best fit can't place, is the agent's own
    // turn, built from the same catalog.
    [COORDINATOR_KIND]: defineCoordinatorFlow({
      installation,
      delegateFlows: delegateFlowsUnderControl([agent]),
      routeModel: ROUTE_MODEL,
      agent: { catalog: blocks },
    }),
  };
  const copies = hireWorkforce(installation);

  return {
    installation,
    copies,
    errors: [
      ...errors.map((e) => e.path),
      ...skillErrors.flatMap((seat) => seat.errors.map((e) => e.path)),
      ...teamErrors.map((e) => e.path),
    ],
  };
}
