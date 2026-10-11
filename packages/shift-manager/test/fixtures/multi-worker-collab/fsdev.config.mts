/**
 * What `fsdev dev` serves — the whole of serving the hire.
 *
 *     fsdev dev --config packages/shift-manager/test/fixtures/multi-worker-collab/fsdev.config.mts
 *
 * One `FlowState` holding the hired workers' flows and the inventory writer,
 * and nothing else: no app, no wrapper, no route of the lab's own, and no
 * package manifest. The file is ESM by extension, which is what makes the
 * tree read's top-level await legal without one. The DevTool the server hands
 * out is the shipped bundle on its documented navigation.
 *
 * ## The controls this file reads
 *
 * `GOAL_CONTROL` is the one switch, end to end: the goal check sets it on the
 * process it spawns and this file reads it. The routing controls
 * (`swapped-desks`, `one-worker`) are the filer's, not the server's: see
 * `routesFor` in `host.mts`.
 *
 * - `ignore-the-answer`, `silent-park` — passed to the worker flow.
 * - `no-inventory` — the boot skips `openInventory`, so the organization's
 *   inventory holds no rows.
 *
 * Any other value leaves the server as written.
 *
 * ## The boot
 *
 * After the `FlowState` is built, and before this module finishes loading —
 * so before `fsdev dev` takes a request — {@link openLab} opens the
 * inventory, in-process, exactly as the inventory docs show an app doing it.
 * A boot whose inventory reports a problem throws here, and the server does
 * not start.
 */
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAB_DB_PATH, LAB_USER_ID, hireLab, openLab, readLabTree } from "./host.mts";
import type { WorkerControl } from "./workforce/flows/workers/worker.mts";

const control = process.env.GOAL_CONTROL ?? "";
const workerControl: WorkerControl | undefined =
  control === "ignore-the-answer" || control === "silent-park" ? control : undefined;

/**
 * Where each attempt leaves its line. The goal check points it at its own
 * scratch file; a user running the server by hand gets one in the temp dir.
 */
const outbox = process.env.MULTI_WORKER_COLLAB_OUTBOX ?? join(tmpdir(), "multi-worker-collab-work.ndjson");

// Durable across the run: SQLite under the server's working directory, the
// same shape `fsdev dev` builds when it discovers flows itself.
mkdirSync(".fsdev/data", { recursive: true });

const tree = await readLabTree();

const hired = hireLab({
  tree,
  outbox,
  ...(workerControl === undefined ? {} : { workerControl }),
});

const flowstate = createFlowState({
  flows: hired.flows,
  stores: { default: { primary: sqliteStores({ filename: LAB_DB_PATH }) } },
  // The documented DevTool setting: which user the navigator lists sessions
  // for. Not a wrapper — the same field any app sets.
  devtool: { userId: LAB_USER_ID },
} as never);

if (control !== "no-inventory") await openLab(flowstate, hired);

export default flowstate;
