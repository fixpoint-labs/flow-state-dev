/**
 * fsdev config — the single runtime wiring for this app, consumed by both the
 * Next.js route handler (via `lib/server.ts`) and the `fsdev` CLI.
 *
 * Run a flow from the CLI without the browser:
 *   pnpm fsdev run hello-chat chat -i '{"message":"hi"}'
 *
 * `createModelResolver` is built by `createFlowState` from the (omitted)
 * `models` option, which auto-detects providers from env vars
 * (`OPENAI_API_KEY`, etc.) — model strings like "openai/gpt-5-mini" in the flow
 * resolve automatically.
 */
import { createFlowState, inMemoryStores } from "@flow-state-dev/server";
import helloChatFlow from "./src/flows/hello-chat/flow";

export default createFlowState({
  flows: { helloChat: helloChatFlow },
  // In-memory stores — this example keeps no state across restarts.
  // `createFlowState` requires at least one profile, where `createFlowApiRouter`
  // defaulted to in-memory implicitly.
  stores: { default: { primary: inMemoryStores() } },
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
