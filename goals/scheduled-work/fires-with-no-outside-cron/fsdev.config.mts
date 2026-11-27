/**
 * The goal's app as `fsdev run` loads it: the same app the servers run, on
 * the SQLite file and ledger `run.mts` names, with the default scheduler.
 */
import { goalApp } from "./app.mts";

const env = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`fsdev.config: ${name} is not set`);
  return value;
};

export default goalApp({ process: "fsdev-run", ledger: env("GOAL_LEDGER"), store: { sqlite: env("GOAL_DB") } }).app;
