/**
 * The same app with durable execution turned off. Its stop must be refused at
 * the stop, naming the rule and the setting.
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
  durable: false,
});
