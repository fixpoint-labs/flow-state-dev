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
export {
  createMoatAdapter,
  resolveMoatSandbox,
  MoatError,
  MoatNotInstalledError,
  MoatVersionError,
  MoatGrantsError,
  MoatRunStartError,
  MoatRunTimeoutError,
  MoatRunStoppedError,
  MoatBinaryReadError,
  FileNotFoundError as MoatFileNotFoundError,
  buildRunArgs as buildMoatRunArgs,
  buildExecArgs as buildMoatExecArgs,
  buildWriteFileArgs as buildMoatWriteFileArgs,
  generateMoatYaml,
  satisfiesMinVersion as moatSatisfiesMinVersion,
  MOAT_SUPPORTED_RANGE,
} from "./moat";
export type { ResolveMoatOptions, ResolveMoatResult, SpawnFn as MoatSpawnFn, SpawnResult as MoatSpawnResult } from "./moat";
