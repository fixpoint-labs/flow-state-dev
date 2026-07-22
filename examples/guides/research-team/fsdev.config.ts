/**
 * fsdev config for the research-team example — the single runtime wiring,
 * consumed by the `fsdev` CLI.
 *
 * Run each action from the CLI:
 *   pnpm fsdev run research-team research -i '{}'
 *   pnpm fsdev run research-team researchCompetitors -i '{"subject":"Linear","competitors":["Jira","Asana","Trello"]}'
 *   OPENAI_API_KEY=... pnpm fsdev run research-team chat -i '{"message":"research ACME Corp"}'
 *
 * `research` and `researchCompetitors` use deterministic handler workers, so
 * they run with no API key. `chat` runs the delegation skills through a
 * coordinator model, so it needs OPENAI_API_KEY.
 *
 * The `chat` action's generator resolves through the `chat` intent below,
 * which falls back to openai/gpt-5.4-mini and auto-detects the provider from
 * `OPENAI_API_KEY`. Declaring the intent also lets `fsdev`'s `FSDEV_DEFAULT_MODEL`
 * override apply cleanly instead of erroring on a flow with no intents.
 */
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import researchTeamFlow from "./src/flow";

export default createFlowState({
  flows: { "research-team": researchTeamFlow },
  models: {
    default: "openai/gpt-5.4-mini",
    intents: { chat: ["openai/gpt-5.4-mini"] },
  },
  // In-memory stores — the example keeps no state across restarts.
  stores: { default: { primary: inMemoryStores() } },
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
