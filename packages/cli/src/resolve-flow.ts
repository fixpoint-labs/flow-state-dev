/**
 * Resolves flow definitions from disk for `fsdev run`.
 * Scans conventional directories (src/flows/, flows/) and imports modules
 * that default-export a FlowInstance. Also scans one level of subdirectories
 * for monorepo structures (packages/*, examples/*, apps/*, labs/*).
 * Modules that throw during import are reported through the optional
 * `onImportFailed` callback; discovery continues with remaining modules.
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
const MONOREPO_PARENT_DIRS = ["packages", "examples", "apps", "labs"];

/** A flow module that was discovered but threw during import. */
export interface FlowImportFailure {
  /** Absolute path of the module that failed to import. */
  filePath: string;
  /** Normalized "Name: message" for Error throws; String(err) otherwise. */
  message: string;
  /** The original thrown value. */
  cause: unknown;
}

export interface DiscoverFlowsOptions {
  /** Working directory to search from (defaults to process.cwd()). */
  cwd?: string;
  /** Explicit directories to search for flows (overrides default discovery). */
  flowDirs?: string[];
  /**
   * Invoked once per module that throws during import. Discovery continues
   * with remaining modules. Default: failures are ignored (the library never
   * writes to stderr), so programmatic callers see no behavior change.
   */
  onImportFailed?: (failure: FlowImportFailure) => void;
}

/**
 * Discovers all flow instances from conventional directories.
 *
 * Search order:
 * 1. If `flowDirs` is provided, search only those directories.
 * 2. Otherwise, search `src/flows/` and `flows/` at the root.
 * 3. Then scan monorepo subdirectories: packages/*, examples/*, apps/*,
 *    labs/* looking for src/flows/ and flows/ within each.
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

  const onImportFailed = options.onImportFailed;

  if (options.flowDirs !== undefined) {
    // Explicit directories — search only these
    for (const dir of options.flowDirs) {
      const flowsDir = isAbsolute(dir) ? dir : resolve(root, dir);
      await scanFlowsDir(flowsDir, addFlow, onImportFailed);
    }
  } else {
    // Default discovery: root-level conventional dirs first
    for (const dir of FLOW_DIRS) {
      await scanFlowsDir(resolve(root, dir), addFlow, onImportFailed);
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
          await scanFlowsDir(resolve(subPath, flowDir), addFlow, onImportFailed);
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
 * Import failures are reported through `onImportFailed` and never abort
 * the scan; modules that import fine but aren't flows are skipped silently
 * (flows directories legitimately contain helper modules).
 */
async function scanFlowsDir(
  flowsDir: string,
  onFlow: (flow: FlowInstance) => Promise<void>,
  onImportFailed?: (failure: FlowImportFailure) => void,
): Promise<void> {
  if (!existsSync(flowsDir) || !statSync(flowsDir).isDirectory()) {
    return;
  }

  const entries = readdirSync(flowsDir);
  for (const entry of entries) {
    const entryPath = resolve(flowsDir, entry);
    if (!statSync(entryPath).isDirectory()) {
      if (entry.endsWith(".ts") || entry.endsWith(".js")) {
        const result = await tryImportFlow(entryPath);
        if (result.status === "flow") {
          await onFlow(result.flow);
        } else if (result.status === "failed") {
          onImportFailed?.(result.failure);
        }
      }
      continue;
    }

    // Look for flow.ts or index.ts inside the subdirectory
    for (const candidate of ["flow.ts", "flow.js", "index.ts", "index.js"]) {
      const candidatePath = resolve(entryPath, candidate);
      if (!existsSync(candidatePath)) {
        continue;
      }
      const result = await tryImportFlow(candidatePath);
      if (result.status === "flow") {
        await onFlow(result.flow);
        break;
      }
      if (result.status === "failed") {
        // A present-but-crashing candidate means this directory's flow is
        // broken, not absent. Don't fall through to the next candidate:
        // barrel index files re-export the same module and would only
        // re-fail or mask the failure.
        onImportFailed?.(result.failure);
        break;
      }
      // "not-flow" falls through: a non-flow flow.ts alongside a flow
      // index.ts must keep working.
    }
  }
}

/** Outcome of importing a single candidate flow module. */
type FlowImportResult =
  | { status: "flow"; flow: FlowInstance }
  | { status: "not-flow" }
  | { status: "failed"; failure: FlowImportFailure };

/**
 * Attempts to import a module and extract a FlowInstance from its default
 * export. Distinguishes "imported but not a flow" from "threw during import"
 * so callers can skip the former silently and report the latter.
 */
async function tryImportFlow(filePath: string): Promise<FlowImportResult> {
  try {
    const mod = await import(filePath);
    const exported = mod.default;
    if (isFlowInstance(exported)) {
      return { status: "flow", flow: exported };
    }
    return { status: "not-flow" };
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { status: "failed", failure: { filePath, message, cause: err } };
  }
}

/**
 * Formats one import failure as a stderr warning block for CLI commands.
 * Lives here so the warning format has a single home; not part of the
 * package's public API.
 */
export function formatImportFailureWarning(failure: FlowImportFailure): string {
  return `Warning: failed to import flow module: ${failure.filePath}\n  ${failure.message}\n`;
}

/**
 * Formats the failed-import section appended to discovery error messages
 * ("Flow not found" / "No flows found"). Empty string when nothing failed.
 * Like formatImportFailureWarning, not part of the package's public API.
 */
export function formatFailedImportSection(failures: FlowImportFailure[]): string {
  if (failures.length === 0) {
    return "";
  }
  return (
    `\n${failures.length} flow module(s) failed to import:\n` +
    failures.map((f) => `  ${f.filePath}: ${f.message}`).join("\n")
  );
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
