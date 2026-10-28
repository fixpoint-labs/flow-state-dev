/**
 * Control `no-tool`: the Shift Coordinator without its project tools.
 *
 * Loaded into the served Lab in place of `packages/shift-manager/teams/devteam/host.mts`
 * (`swap-loader.mjs`, which leaves this module's own import of it alone). It
 * is that module, except that `openLab` opens the Lab with
 * `withoutProjectTools`: the catalog the agent turn is built with, which the
 * Shift Coordinator's coordinator turn shares, lacks `createProject` and
 * `setRepository`, and no worker's `tools:` names them, as before the Shift
 * Coordinator had them. The Lab boots as before. The goal must fail at "shift-coordinator".
 */
import { openLab as openLabWithTools } from "../../../../packages/shift-manager/teams/devteam/host.mts";

export * from "../../../../packages/shift-manager/teams/devteam/host.mts";

/** `openLab`, with the project tools left out. */
export const openLab: typeof openLabWithTools = (options) => openLabWithTools({ ...options, withoutProjectTools: true });
