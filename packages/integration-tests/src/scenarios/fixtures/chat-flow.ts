/**
 * Minimal chat-style fixture flow for ask-mode and tool-loop scenarios.
 *
 * Stays intentionally small — one generator with a search tool — so the
 * scenarios under `scenarios/` can assert on tool-loop convergence and
 * single-round-trip happy paths without inheriting the kitchen-sink
 * chat-agent flow's transitive baggage (skills, MCP, perspective
 * generators, bias analyzers).
 */
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const chatInputSchema = z.object({
  message: z.string().min(1)
});

const searchTool = handler({
  name: "search",
  description: "Search the web for information.",
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
  execute: async (input) => ({
    results: [`Result for: ${input.query}`]
  })
});

const chatGenerator = generator({
  name: "chat-generator",
  model: "preset/small",
  prompt: "You are a helpful assistant. Use the search tool when needed.",
  inputSchema: chatInputSchema,
  user: (input) => input.message,
  outputSchema: z.string(),
  tools: [searchTool],
  history: true,
  agentType: "primary",
  maxIterations: 6
});

const chatPipeline = sequencer({ name: "chat-pipeline", inputSchema: chatInputSchema })
  .then(chatGenerator);

const chatFlow = defineFlow({
  kind: "test-chat",
  requireUser: true,
  actions: {
    chat: {
      inputSchema: chatInputSchema,
      block: chatPipeline,
      userMessage: (input) => input.message
    }
  }
});

export default chatFlow({ id: "default" });
