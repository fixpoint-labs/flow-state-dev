import { createModelResolver } from "@flow-state-dev/core/models";
import {
  createFlowApiRouter,
  createFlowRegistry,
} from "@flow-state-dev/server";
import helloChatFlow from "@/src/flows/hello-chat/flow";

// Auto-detects providers from env vars (OPENAI_API_KEY, etc.).
// Model strings like "openai/gpt-5-mini" in flow definitions are resolved automatically.
const modelResolver = createModelResolver();

const registry = createFlowRegistry();
registry.register(helloChatFlow);

export const router = createFlowApiRouter({
  registry,
  modelResolver,
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
