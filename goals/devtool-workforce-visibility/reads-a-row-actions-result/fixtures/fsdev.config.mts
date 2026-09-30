/**
 * What `fsdev dev` serves for this goal: the fixture flow, durable, on SQLite
 * under the server's working directory, with the debug endpoints on so the
 * check can find the suspension it resumes.
 *
 *     ROW_RESULT_ANSWERS='<json>' fsdev dev --config <this file>
 *
 * The answers come from the goal check (its fixture, held out); a person
 * running the server by hand gets placeholder ones.
 */
import { mkdirSync } from "node:fs";
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { ROW_RESULTS_KIND, rowResultsFlow, type RowAnswers } from "./flow.mts";

/** The user the DevTool's navigator lists sessions for. */
export const ROW_RESULTS_USER = "u_row_results";

const answers: RowAnswers = process.env.ROW_RESULT_ANSWERS
  ? (JSON.parse(process.env.ROW_RESULT_ANSWERS) as RowAnswers)
  : {
      handover: "refused (handover)",
      hook: "refused (hook)",
      ref: { ok: true, value: "ref" },
      suspend: "approved",
      hookFails: { refusal: "refused (hook fails)", error: "the hook failed" },
    };

mkdirSync(".fsdev/data", { recursive: true });

const flow = rowResultsFlow(answers)();

export default createFlowState({
  flows: { [ROW_RESULTS_KIND]: flow },
  stores: { default: { primary: sqliteStores({ filename: ".fsdev/data/row-results.db" }) } },
  durable: true,
  debugEndpointsEnabled: true,
  devtool: { userId: ROW_RESULTS_USER },
} as never);
