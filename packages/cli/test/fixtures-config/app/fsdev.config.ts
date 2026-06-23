/**
 * Test fixture: a config whose flow runs a generator, so the integration tests
 * can observe (a) that the run resolves models through the config's resolver
 * and (b) that it writes through the config's store instances. Both are stashed
 * on globalThis for the test to read after the run.
 */
import {
  createFlowState,
  createInMemoryStores,
  type StoreAdapter,
  type StoreRegistry,
} from "@flow-state-dev/server";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { defineFlow, generator, type ModelResolver } from "@flow-state-dev/core";
import { z } from "zod";

const g = globalThis as unknown as {
  __fsdevModelCalls: string[];
  __fsdevTestStores?: StoreRegistry;
};
g.__fsdevModelCalls = [];

/** A store adapter that publishes its resolved registry for assertions. */
function stashingStores(): StoreAdapter {
  let registry: StoreRegistry | undefined;
  return {
    capabilities: ["primary"],
    resolve() {
      registry ??= createInMemoryStores();
      g.__fsdevTestStores = registry;
      return Promise.resolve(registry);
    },
  };
}

const mock = createMockModelResolver({
  generators: {
    "echo-gen": mockGenerator({
      name: "echo-gen",
      script: [{ text: "from-config", finishReason: "stop" }],
    }),
  },
  policy: "allow",
});

/** Records every model id the run resolves, then delegates to the mock. */
const recordingResolver = ((modelId: string, blockName?: string) => {
  g.__fsdevModelCalls.push(modelId);
  return mock(modelId, blockName);
}) as ModelResolver;
recordingResolver.resolveId = (id: string) => mock.resolveId(id);

const echoGen = generator({
  name: "echo-gen",
  model: "config/default-model",
  prompt: "You are an echo bot.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
});

const genFlow = defineFlow({
  kind: "gen",
  requireUser: true,
  actions: {
    respond: {
      block: echoGen,
      userMessage: (input) => input.message,
    },
  },
})({ id: "default" });

export default createFlowState({
  flows: { gen: genFlow },
  modelResolver: recordingResolver,
  stores: { default: { primary: stashingStores() } },
});
