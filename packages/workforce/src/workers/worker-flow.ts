/**
 * `workerFlow`: a worker flow built on the installation that runs its workers.
 *
 * A worker flow declares its installation's session and resources, so it is
 * built with the installation in hand. An app that defines its flows beside
 * the installation passes them in `workerFlows` already built. A flow that
 * lives in its own file, under `workforce/flows/workers/` where `fsdev gen`
 * finds it, has no installation to import, so its module exports a builder
 * instead, and the installation builds it, once, with itself:
 *
 * ```ts
 * // workforce/flows/workers/desk-clerk.ts
 * export default workerFlow((installation) =>
 *   defineFlow({
 *     kind: "desk-clerk",
 *     session: installation.session(),
 *     resources: { ...installation.resources },
 *     ...
 *   })
 * );
 * ```
 */
import type { WorkerInstallation } from "./installation";

const BUILDER = Symbol.for("flow-state-dev/workforce/worker-flow");

/** A worker flow waiting for its installation. See {@link workerFlow}. */
export interface WorkerFlowBuilder {
  readonly [BUILDER]: true;
  /** Builds the flow on the installation that runs its workers. Called once per installation. */
  readonly build: (installation: WorkerInstallation) => unknown;
  /** Whether the app keeps the flow for the workers its files define. */
  readonly standardOnly: boolean;
}

/**
 * Declare a worker flow built on its installation.
 *
 * @param build Builds the flow (`defineFlow({ ..., session: installation.session() })`).
 * @param options `standardOnly` keeps the flow for the workers the app's files define.
 * @returns An entry for `createWorkerInstallation({ workerFlows })`, and for
 *   the `kinds` map `fsdev gen` writes.
 */
export function workerFlow(
  build: (installation: WorkerInstallation) => unknown,
  options: { standardOnly?: boolean } = {}
): WorkerFlowBuilder {
  return { [BUILDER]: true, build, standardOnly: options.standardOnly === true };
}

/** Whether a `workerFlows` entry is a {@link workerFlow} builder. */
export function isWorkerFlowBuilder(entry: unknown): entry is WorkerFlowBuilder {
  return typeof entry === "object" && entry !== null && (entry as Record<symbol, unknown>)[BUILDER] === true;
}
