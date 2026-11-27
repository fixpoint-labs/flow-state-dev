/**
 * The Teammates lab as the closure's j2-teammates scene serves it: the lab's
 * own host (`labs/teammates/host.mts`) on its own workers, read from the
 * environment as the lab's own config reads it, with only the model scripted
 * (`scripts.mts`) and every coding worker on harness-manager's scripted coder.
 * The run serves it twice with `fsdev dev --config`, and swaps the host's
 * store line to Postgres as each process loads it (`run.mts`).
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { openTeammates } from "../../../../labs/teammates/host.mts";
import { labModels } from "./scripts.mts";

const need = (key: string) => {
  const value = process.env[key];
  if (value === undefined || value === "") throw new Error(`j2-teammates lab: ${key} is unset`);
  return value;
};

const store = need("TEAMMATES_STORE");
mkdirSync(dirname(store), { recursive: true });

export default await openTeammates({
  store,
  model: "test/scripted",
  userId: need("TEAMMATES_USER"),
  workdir: need("TEAMMATES_WORKDIR"),
  runsRoot: process.env.TEAMMATES_RUNS ?? join(dirname(store), "teammates-runs"),
  modelResolver: labModels(/You are (Chief of Staff|chief-of-staff)[,.]/i, "teammates.cursor"),
  scriptedHarnessStepMs: 50,
});
