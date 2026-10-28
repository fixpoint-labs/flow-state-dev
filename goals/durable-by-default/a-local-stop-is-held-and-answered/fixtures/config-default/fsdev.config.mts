/**
 * An app config that never mentions `durable`: SQLite stores, nothing else.
 * Its stops must be held by default.
 */
import { mkdirSync } from "node:fs";
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import flow from "../flows/review/flow.ts";

// better-sqlite3 does not create the directory.
mkdirSync(".fsdev/data", { recursive: true });

export default createFlowState({
  flows: { "durable-goal": flow },
  stores: { default: { primary: sqliteStores({ filename: ".fsdev/data/app.db" }) } },
});
