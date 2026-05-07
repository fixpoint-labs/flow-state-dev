import { createModelResolver } from "@flow-state-dev/core/models";
import {
  createFlowApiRouter,
  createFlowRegistry,
} from "@flow-state-dev/server";
import tradingDeskFlow from "@/src/flows/trading-desk/flow";

const modelResolver = createModelResolver();

const registry = createFlowRegistry();
registry.register(tradingDeskFlow);

export const router = createFlowApiRouter({
  registry,
  modelResolver,
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
