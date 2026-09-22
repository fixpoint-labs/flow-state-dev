/**
 * What `fsdev dev` serves — the whole of serving the hire.
 *
 *     fsdev dev --config goals/multi-seat-collab/lab/fsdev.config.mts
 *
 * One `FlowState` holding the hired seats and the channel singleton, and
 * nothing else: no app, no wrapper, no route of the lab's own, and no package
 * manifest. The file is ESM by extension, which is what makes the tree read's
 * top-level await legal without one. The DevTool the server hands out is the
 * shipped bundle on its documented navigation.
 *
 * ## The app's routing, and where the controls move it
 *
 * {@link ROUTES} is this app's desk -> seat map. It is written here, as an app
 * would write it, and never derived from the tree: each seat's own `WORKER.md`
 * is what the checks grade a row against, so the two sources can disagree —
 * which is exactly what two of the controls make them do. `GOAL_CONTROL` is
 * the one switch, end to end: the goal check sets it on the process it spawns
 * and this file reads it.
 *
 * - `swapped-desks` — the two desks trade seats.
 * - `one-seat` — both desks route to the first seat; the other gets nothing.
 * - `ignore-the-answer`, `silent-park` — passed to the worker kind.
 *
 * Any other value leaves the app as written.
 */
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAB_USER_ID, hireLab, readLabTree } from "./host.mts";
import type { WorkerControl } from "./kinds.mts";

/** Desk key -> seat id. The app's wiring — see the module header. */
export const ROUTES: Readonly<Record<string, string>> = {
  build: "eng.builder",
  review: "eng.reviewer",
};

/** Apply a routing control, if one is set. */
function routesFor(control: string): Record<string, string> {
  const [first, second] = Object.keys(ROUTES) as [string, string];
  if (control === "swapped-desks") {
    return { [first]: ROUTES[second]!, [second]: ROUTES[first]! };
  }
  if (control === "one-seat") {
    return { [first]: ROUTES[first]!, [second]: ROUTES[first]! };
  }
  return { ...ROUTES };
}

const control = process.env.GOAL_CONTROL ?? "";
const workerControl: WorkerControl | undefined =
  control === "ignore-the-answer" || control === "silent-park" ? control : undefined;

/**
 * Where each attempt leaves its line. The goal check points it at its own
 * scratch file; a person running the server by hand gets one in the temp dir.
 */
const outbox = process.env.MULTI_SEAT_COLLAB_OUTBOX ?? join(tmpdir(), "multi-seat-collab-work.ndjson");

// Durable across the run: SQLite under the server's working directory, the
// same shape `fsdev dev` builds when it discovers flows itself.
mkdirSync(".fsdev/data", { recursive: true });

const tree = await readLabTree();

export default createFlowState({
  flows: hireLab({
    tree,
    routes: routesFor(control),
    outbox,
    ...(workerControl === undefined ? {} : { workerControl }),
  }),
  stores: { default: { primary: sqliteStores({ filename: ".fsdev/data/multi-seat-collab.db" }) } },
  // The documented DevTool setting: which user the navigator lists sessions
  // for. Not a wrapper — the same field any app sets.
  devtool: { userId: LAB_USER_ID },
} as never);
