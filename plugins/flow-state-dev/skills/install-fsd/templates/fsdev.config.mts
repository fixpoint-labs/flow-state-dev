// fsd:generated
import { openai } from "@ai-sdk/openai";
import { createModelResolver } from "@flow-state-dev/core/models";
import { createFlowState, filesystemStores } from "@flow-state-dev/engine";
import hello from "./flows/hello/flow.mts";

const modelResolver = createModelResolver({
  providers: { openai },
  defaultModel: "openai/gpt-5.4-mini",
  intents: { chat: ["openai/gpt-5.4-mini"] },
});

export default createFlowState({
  flows: { hello },
  modelResolver,
  stores: {
    default: {
      primary: filesystemStores({
        rootDir: ".fsdev/data",
        developmentOnly: true,
      }),
    },
  },
  devtool: {
    userId: "demo",
    bearerToken: process.env.FSD_DEMO_TOKEN,
  },
});
