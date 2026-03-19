/**
 * Resolves flow definitions from disk for `fsdev run`.
 * Scans conventional directories (src/flows/, flows/) and imports modules
 * that default-export a FlowInstance. Also scans one level of subdirectories
 * for monorepo structures (packages/*, examples/*, apps/*).
 */
import { resolve, isAbsolute } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { CliError } from "./resolve-block";
import { EXIT_INVALID_ARGS, EXIT_DISCOVERY_ERROR } from "./exit-codes";

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
 * Monorepo glob patterns — scan one level of subdirectories for flow dirs.
 * Matches structures like examples/hello-chat/src/flows/, packages/foo/flows/.
 */
const MONOREPO_PARENT_DIRS = ["packages", "examples", "apps"];

export interface DiscoverFlowsOptions {
  /** Working directory to search from (defaults to process.cwd()). */
  cwd?: string;
  /** Explicit directories to search for flows (overrides default discovery). */
  flowDirs?: string[];
}

/**
 * Discovers all flow instances from conventional directories.
 *
 * Search order:
 * 1. If `flowDirs` is provided, search only those directories.
 * 2. Otherwise, search `src/flows/` and `flows/` at the root.
 * 3. Then scan monorepo subdirectories: packages/*, examples/*, apps/*
 *    looking for src/flows/ and flows/ within each.
 *
 * Deduplicates flows by kind (first discovered wins).
 */
export async function discoverFlows(cwdOrOptions?: string | DiscoverFlowsOptions): Promise<FlowInstance[]> {
  const options = typeof cwdOrOptions === "string" ? { cwd: cwdOrOptions } : (cwdOrOptions ?? {});
  const root = options.cwd ?? process.cwd();
  const seen = new Set<string>();
  const flows: FlowInstance[] = [];

  async function addFlow(flow: FlowInstance): Promise<void> {
    if (!seen.has(flow.kind)) {
      seen.add(flow.kind);
      flows.push(flow);
    }
  }

  if (options.flowDirs !== undefined) {
    // Explicit directories — search only these
    for (const dir of options.flowDirs) {
      const flowsDir = isAbsolute(dir) ? dir : resolve(root, dir);
      await scanFlowsDir(flowsDir, addFlow);
    }
  } else {
    // Default discovery: root-level conventional dirs first
    for (const dir of FLOW_DIRS) {
      await scanFlowsDir(resolve(root, dir), addFlow);
    }

    // Monorepo fallback: scan one level of subdirectories
    for (const parentName of MONOREPO_PARENT_DIRS) {
      const parentDir = resolve(root, parentName);
      if (!existsSync(parentDir) || !statSync(parentDir).isDirectory()) {
        continue;
      }
      for (const sub of readdirSync(parentDir)) {
        const subPath = resolve(parentDir, sub);
        if (!statSync(subPath).isDirectory()) {
          continue;
        }
        for (const flowDir of FLOW_DIRS) {
          await scanFlowsDir(resolve(subPath, flowDir), addFlow);
        }
      }
    }
  }

  return flows;
}

/**
 * Returns the list of directories that were searched,
 * for use in error messages.
 */
export function getSearchedDirs(cwdOrOptions?: string | DiscoverFlowsOptions): string[] {
  const options = typeof cwdOrOptions === "string" ? { cwd: cwdOrOptions } : (cwdOrOptions ?? {});
  const root = options.cwd ?? process.cwd();

  if (options.flowDirs !== undefined) {
    return options.flowDirs;
  }

  const dirs: string[] = [...FLOW_DIRS];

  for (const parentName of MONOREPO_PARENT_DIRS) {
    const parentDir = resolve(root, parentName);
    if (existsSync(parentDir) && statSync(parentDir).isDirectory()) {
      for (const sub of readdirSync(parentDir)) {
        const subPath = resolve(parentDir, sub);
        if (statSync(subPath).isDirectory()) {
          for (const flowDir of FLOW_DIRS) {
            const candidate = resolve(subPath, flowDir);
            if (existsSync(candidate) && statSync(candidate).isDirectory()) {
              dirs.push(`${parentName}/${sub}/${flowDir}`);
            }
          }
        }
      }
    }
  }

  return dirs;
}

/**
 * Scans a single flows directory for FlowInstance modules.
 */
async function scanFlowsDir(flowsDir: string, onFlow: (flow: FlowInstance) => Promise<void>): Promise<void> {
  if (!existsSync(flowsDir) || !statSync(flowsDir).isDirectory()) {
    return;
  }

  const entries = readdirSync(flowsDir);
  for (const entry of entries) {
    const entryPath = resolve(flowsDir, entry);
    if (!statSync(entryPath).isDirectory()) {
      if (entry.endsWith(".ts") || entry.endsWith(".js")) {
        const flow = await tryImportFlow(entryPath);
        if (flow !== undefined) {
          await onFlow(flow);
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
          await onFlow(flow);
          break;
        }
      }
    }
  }
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
    throw new CliError(`Flow file not found: ${filePath}`, EXIT_DISCOVERY_ERROR);
  }

  let mod: Record<string, unknown>;
  try {
    mod = await import(filePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError(`Failed to import flow file: ${message}`, EXIT_DISCOVERY_ERROR);
  }

  const flow = mod.default;
  if (flow === undefined) {
    throw new CliError(
      `Flow file has no default export: ${filePath}`,
      EXIT_DISCOVERY_ERROR,
    );
  }

  if (!isFlowInstance(flow)) {
    throw new CliError(
      `Default export is not a valid FlowInstance (must have kind and actions): ${filePath}`,
      EXIT_DISCOVERY_ERROR,
    );
  }

  return flow;
}
