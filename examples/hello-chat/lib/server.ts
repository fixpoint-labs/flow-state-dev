import { openai } from "@ai-sdk/openai";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createAiSdkModelResolver,
} from "@flow-state-dev/server";
import helloChatFlow from "@/src/flows/hello-chat/flow";

// Pass the openai provider directly — reads OPENAI_API_KEY from env.
// Model strings like "gpt-5" in flow definitions are resolved via openai().
const modelResolver = createAiSdkModelResolver(openai);

const registry = createFlowRegistry();
registry.register(helloChatFlow);

export const router = createFlowApiRouter({
  registry,
  modelResolver,
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
