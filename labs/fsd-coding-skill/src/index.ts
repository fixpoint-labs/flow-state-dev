/**
 * Throwaway FSD-coding-skill lab. One flow, four static doors, Cursor harness.
 */
export { createFsdCodingFlow, type FsdCodingHostOptions } from "./flow";
export { createHostResolvers, type HostResolverOptions } from "./host";
export { parseArgs, runCli, CliUsageError, type ParsedCli, type RunCliOptions } from "./cli";
export {
  DOORS,
  DOOR_PREFIX,
  FLOW_KIND,
  fixFsdInputSchema,
  sessionStateSchema,
  taskInputSchema,
  type CodingDoor,
  type FixFsdInput,
  type TaskInput,
} from "./schemas";
