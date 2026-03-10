/**
 * Resolves flow definitions from disk for `fsdev run`.
 * Scans conventional directories (src/flows/, flows/) and imports modules
 * that default-export a FlowInstance.
 */
import { resolve, isAbsolute, basename, extname } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { CliError } from "./resolve-block.js";
import { EXIT_INVALID_ARGS } from "./exit-codes.js";

/**
 * Structural check for a FlowInstance. Uses duck-typing because flow instances
 * are created by defineFlow() across packages.
 */
export function isFlowInstance(value: unknown): value is FlowInstance {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof (value as any).kind === "string" &&
    "actions" in value &&
    typeof (value as any).actions === "object" &&
    (value as any).actions !== null
  );
}

/** Conventional directories to scan for flow definitions (relative to cwd). */
const FLOW_DIRS = ["src/flows", "flows"];

/**
 * Discovers all flow instances from conventional directories.
 * Scans each subdirectory for a module with a default-exported FlowInstance.
 *
 * Directory structure convention:
 *   src/flows/<flow-name>/flow.ts  → default exports a FlowInstance
 *   flows/<flow-name>/flow.ts      → default exports a FlowInstance
 */
export async function discoverFlows(cwd?: string): Promise<FlowInstance[]> {
  const root = cwd ?? process.cwd();
  const flows: FlowInstance[] = [];

  for (const dir of FLOW_DIRS) {
    const flowsDir = resolve(root, dir);
    if (!existsSync(flowsDir) || !statSync(flowsDir).isDirectory()) {
      continue;
    }

    const entries = readdirSync(flowsDir);
    for (const entry of entries) {
      const entryPath = resolve(flowsDir, entry);
      if (!statSync(entryPath).isDirectory()) {
        // Also check if it's a direct .ts file that exports a flow
        if (entry.endsWith(".ts") || entry.endsWith(".js")) {
          const flow = await tryImportFlow(entryPath);
          if (flow !== undefined) {
            flows.push(flow);
          }
        }
        continue;
      }

      // Look for flow.ts or index.ts inside the subdirectory
      for (const candidate of ["flow.ts", "flow.js", "index.ts", "index.js"]) {
        const candidatePath = resolve(entryPath, candidate);
        if (existsSync(candidatePath)) {
          const flow = await tryImportFlow(candidatePath);
          if (flow !== undefined) {
            flows.push(flow);
            break;
          }
        }
      }
    }
  }

  return flows;
}

/**
 * Attempts to import a module and extract a FlowInstance from its default export.
 * Returns undefined if the module doesn't export a FlowInstance.
 */
async function tryImportFlow(filePath: string): Promise<FlowInstance | undefined> {
  try {
    const mod = await import(filePath);
    const exported = mod.default;
    if (isFlowInstance(exported)) {
      return exported;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves a single flow file path to a FlowInstance.
 * Used when a specific file is provided instead of relying on discovery.
 */
export async function resolveFlow(specifier: string): Promise<FlowInstance> {
  const filePath = isAbsolute(specifier) ? specifier : resolve(process.cwd(), specifier);

  if (!existsSync(filePath)) {
    throw new CliError(`Flow file not found: ${filePath}`, EXIT_INVALID_ARGS);
  }

  let mod: Record<string, unknown>;
  try {
    mod = await import(filePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError(`Failed to import flow file: ${message}`, EXIT_INVALID_ARGS);
  }

  const flow = mod.default;
  if (flow === undefined) {
    throw new CliError(
      `Flow file has no default export: ${filePath}`,
      EXIT_INVALID_ARGS,
    );
  }

  if (!isFlowInstance(flow)) {
    throw new CliError(
      `Default export is not a valid FlowInstance (must have kind and actions): ${filePath}`,
      EXIT_INVALID_ARGS,
    );
  }

  return flow;
}
