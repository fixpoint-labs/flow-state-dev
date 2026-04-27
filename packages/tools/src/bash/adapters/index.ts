/**
 * Sandbox adapter barrel exports.
 *
 * Each adapter implements the `Sandbox` interface for a different execution
 * environment. Adapters are swappable — changing the provider requires no
 * modifications to tool or sync logic.
 */

export { createLocalFsSandbox } from "./local-fs";
export type { LocalFsSandboxOptions } from "./local-fs";
export {
  assertCommandWithinWorkspace,
  resolveWithinWorkspace,
} from "./workspace-guards";
export { createVercelAdapter, resolveVercelSandbox } from "./vercel";
export { createUpstashAdapter, resolveUpstashBox } from "./upstash";
export type { UpstashBoxClient } from "./upstash";
export { createJustBashSandbox } from "./just-bash";
