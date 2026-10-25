/**
 * The one host both transports serve: the goal's flows over the SQLite file
 * `GOAL_STORE` names, with a 2 s stale threshold so a request whose host was
 * killed reads as interrupted soon after the restart, not after the router's
 * 60 s default. `fsdev serve` loads it through `fsdev.config.mts`; the
 * in-process leg builds it directly.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { goalFlows } from "./flows.mts";

/** A host over `GOAL_STORE`, serving the notes copy `GOAL_NOTES_ID` names (the second input's address). */
export function goalHost() {
  const filename = process.env.GOAL_STORE;
  const notesId = process.env.GOAL_NOTES_ID;
  if (filename === undefined || filename === "") throw new Error("GOAL_STORE names no SQLite file");
  if (notesId === undefined || notesId === "") throw new Error("GOAL_NOTES_ID names no notes copy");
  // better-sqlite3 does not create the directory.
  mkdirSync(dirname(filename), { recursive: true });
  return createFlowState({
    flows: goalFlows(notesId),
    stores: { default: { primary: sqliteStores({ filename }) } },
    staleSweepThresholdMs: 2_000,
    staleSweepIntervalMs: 500,
  });
}
