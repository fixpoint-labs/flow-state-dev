/**
 * Workforce as a goal's app installs it: the workforce kit over a folder, with
 * the goal's own worker flows in its `workerFlows` slot.
 *
 * A goal whose workers are records in its code writes them as a folder first
 * (`workforceTree`), so every goal reads its workers the way an app does:
 * from `WORKER.md` files the kit claims.
 *
 * ```ts
 * const { installation, copies } = await installWorkers(workforceTree(workers), {
 *   note: workerFlow((installation) => defineNoteFlow(installation), { roles: ["contributor"] }),
 * });
 * ```
 *
 * `copies` is every flow the kit serves: one copy per worker flow (the
 * built-in `agent` included, unless the goal fills one), and the roster flow.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { WorkerFlowEntry, WorkerInstallation, WorkerManifest } from "@flow-state-dev/workforce";
import { workforce, type WorkforceConfig } from "@flow-state-dev/workforce/kit";
import { readWorkforceFolder, type WorkforceFolder } from "@flow-state-dev/workforce/loader";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";

/**
 * One scalar written so the workforce frontmatter reader gives it back unchanged.
 * The reader strips one pair of outer quotes and unescapes nothing, so a string
 * is quoted with a mark it doesn't hold. One it can't give back is refused
 * rather than written as a different value.
 */
function frontmatterScalar(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    throw new Error(`workerFile: a list item can't be a mapping (${JSON.stringify(value)})`);
  }
  if (typeof value !== "string") return String(value);
  if (value.includes("\n")) throw new Error(`workerFile: a frontmatter string can't hold a line break (${JSON.stringify(value)})`);
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  throw new Error(`workerFile: the workforce reader can't give back a string holding both quote marks (${JSON.stringify(value)})`);
}

/** One frontmatter value as the workforce frontmatter reader takes it: quoted strings, flow lists, mappings indented a level deeper each. */
function frontmatterValue(value: unknown, indent = ""): string {
  if (Array.isArray(value)) return `[${value.map(frontmatterScalar).join(", ")}]`;
  if (typeof value === "object" && value !== null) {
    const inner = `${indent}  `;
    return `\n${Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${inner}${key}: ${frontmatterValue(entry, inner)}`)
      .join("\n")}`;
  }
  return frontmatterScalar(value);
}

/** A worker's `WORKER.md` path under the folder, from its id: `team.worker`, or an org worker's bare id. */
export function workerPath(id: string): string {
  const dot = id.indexOf(".");
  return dot < 0 ? `org/workers/${id}/WORKER.md` : `teams/${id.slice(0, dot)}/workers/${id.slice(dot + 1)}/WORKER.md`;
}

/** A worker record as its `WORKER.md`: its declared keys as frontmatter, its body below. */
function workerFile(worker: Pick<WorkerManifest, "declared" | "body">): string {
  const keys = Object.entries(worker.declared).filter(([, value]) => value !== undefined);
  return `---\n${keys.map(([key, value]) => `${key}: ${frontmatterValue(value)}`).join("\n")}\n---\n${worker.body}\n`;
}

const trees: string[] = [];
process.once("exit", () => {
  for (const tree of trees) rmSync(tree, { recursive: true, force: true });
});

/**
 * A workforce folder holding the folders in `from` (copied in order, a later
 * one's files over an earlier one's), `workers`, each as its `WORKER.md`, and
 * `files` by path relative to the folder. It lives in a temporary directory
 * removed when the process exits.
 */
export function workforceTree(
  workers: readonly Pick<WorkerManifest, "id" | "declared" | "body">[],
  files: Readonly<Record<string, string>> = {},
  from: readonly string[] = [],
): string {
  const parent = mkdtempSync(join(tmpdir(), "fsd-goal-workforce-"));
  trees.push(parent);
  const root = join(parent, "workforce");
  for (const folder of from) cpSync(folder, root, { recursive: true });
  const all: Record<string, string> = { ...Object.fromEntries(workers.map((worker) => [workerPath(worker.id), workerFile(worker)])), ...files };
  mkdirSync(root, { recursive: true });
  for (const [path, body] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

/**
 * What the workforce kit reads of `directory`: its workers, teams, documents
 * and references, for a goal that asserts on the records. A file the kit
 * doesn't read is left to the kit's own start to refuse.
 *
 * @throws As the kit's start does, on a file a reader can't load.
 */
export function readTree(directory: string): Promise<WorkforceFolder> {
  return readWorkforceFolder({ path: directory, claim: () => undefined });
}

/**
 * Install the workforce kit over `directory`, with `workerFlows` in its slot
 * and `config` as its config, as an app's `createFlowState({ kits })` does,
 * and hand back the installation it hired and every flow it serves.
 *
 * @throws As an app's start does: a file the kit doesn't read, a worker that
 *   would be refused on its first turn, a worker flow that doesn't declare the
 *   installation's session.
 */
export async function installWorkers(
  directory: string,
  workerFlows: Readonly<Record<string, WorkerFlowEntry>> = {},
  config: Omit<WorkforceConfig, "directory"> = {},
): Promise<{ installation: WorkerInstallation; copies: FlowInstance[] }> {
  let installation: WorkerInstallation | undefined;
  const state = createFlowState({
    kits: [workforce({ ...config, directory })],
    fill: {
      [workforce.slots.workerFlows]: workerFlows,
      [workforce.slots.flows]: { goal: (hired: WorkerInstallation) => ((installation = hired), []) },
    },
    stores: { goal: { primary: inMemoryStores() } },
  });
  await state.ready();
  const copies = (await state.getRuntime()).registry.list();
  await state.dispose();
  if (installation === undefined) throw new Error("installWorkers: the workforce kit hired no installation");
  return { installation, copies };
}
