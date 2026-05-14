import path from "node:path";
import { createGateway } from "@ai-sdk/gateway";
import { createModelResolver } from "@flow-state-dev/core/models";
import {
  createFilesystemStores,
  createFlowApiRouter,
  createFlowRegistry,
} from "@flow-state-dev/server";
import tradingDeskFlow from "@/src/flows/trading-desk/flow";

// Filesystem-backed stores so analysis history survives `pnpm dev` restarts.
// Defaults to `<example>/.fsdev/data` (covered by the root `.gitignore`'s
// `**/.fsdev/**` rule). Override with `FSDEV_DATA_DIR` for testing or to
// redirect storage to a sandbox path.
const dataDir =
  process.env.FSDEV_DATA_DIR ?? path.join(process.cwd(), ".fsdev", "data");

// Pass the OpenAI provider instance explicitly: the resolver's dynamic
// require() path doesn't work under Next.js bundling. The flow emits
// `intent/utility` and `intent/chat` strings (see analysts.ts), so an intent
// map plus a concrete `defaultModel` is required — without them the resolver
// throws on the first generator run.
const modelResolver = createModelResolver({
  gateways: { vercel: createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY }) },
  defaultModel: "vercel/google/gemini-3.1-flash-lite",
  intents: {
    utility: ["vercel/google/gemini-3.1-flash-lite"],
    fast: ["vercel/google/gemini-3.1-flash-lite"],
    full: ["vercel/anthropic/claude-sonnet-4.6"],
  },
});

const registry = createFlowRegistry();
registry.register(tradingDeskFlow);

export const router = createFlowApiRouter({
  registry,
  modelResolver,
  stores: createFilesystemStores({ rootDir: dataDir }),
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
