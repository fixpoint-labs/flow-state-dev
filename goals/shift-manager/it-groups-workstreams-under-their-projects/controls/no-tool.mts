/**
 * Control `no-tool`: the chief of staff without its project tools.
 *
 * Loaded into the served Lab in place of `packages/shift-manager/teams/devteam/host.mts`
 * (`swap-loader.mjs`, which leaves this module's own import of it alone). It
 * is that module, except that `openLab` opens the Lab with
 * `withoutProjectTools`: the agent kind's catalog lacks `createProject` and
 * `setWorkstreams`, and no seat's `tools:` names them, as before the chief of
 * staff had them. The Lab boots as before. The goal must fail at "cos".
 */
import { openLab as openLabWithTools } from "../../../../packages/shift-manager/teams/devteam/host.mts";

export * from "../../../../packages/shift-manager/teams/devteam/host.mts";

/** `openLab`, with the project tools left out. */
export const openLab: typeof openLabWithTools = (options) => openLabWithTools({ ...options, withoutProjectTools: true });
