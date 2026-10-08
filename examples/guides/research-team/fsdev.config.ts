/**
 * fsdev config for the research-team example — the single runtime wiring,
 * consumed by the `fsdev` CLI.
 *
 * Run each action from the CLI:
 *   pnpm fsdev run research-team research -i '{}'
 *   pnpm fsdev run research-team researchCompetitors -i '{"subject":"Linear","competitors":["Jira","Asana","Trello"]}'
 *
 * Both actions use deterministic handler workers, so they run with no API key.
 */
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import researchTeamFlow from "./src/flow";

export default createFlowState({
  flows: { "research-team": researchTeamFlow },
  models: {
    default: "openai/gpt-5.4-mini",
  },
  // In-memory stores — the example keeps no state across restarts.
  stores: { default: { primary: inMemoryStores() } },
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
