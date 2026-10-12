/**
 * Compile-time check on `systemPrompt`: the block and the capability accept
 * every prompt shape the Agent SDK takes, and refuse an object that is not one.
 *
 * The SDK is an optional peer, so its union is declared in this package
 * (`ClaudeAgentSystemPrompt`). This file is what goes red if that declaration
 * drops a shape a host is documented to pass, or widens to any object.
 */
import { claudeCodeAgent } from "../src/sdk/agent";
import { createClaudeCodeAgentCapability } from "../src/sdk/capability";

claudeCodeAgent({ systemPrompt: "You are a narrow agent." });
claudeCodeAgent({ systemPrompt: "" });
claudeCodeAgent({ systemPrompt: ["static", "dynamic"] });
claudeCodeAgent({ systemPrompt: { type: "preset", preset: "claude_code" } });
claudeCodeAgent({
  systemPrompt: { type: "preset", preset: "claude_code", append: "Commit your work." },
});
// A field the SDK has that this package does not name still passes through.
claudeCodeAgent({
  systemPrompt: { type: "preset", preset: "claude_code", excludeDynamicSections: true },
});
createClaudeCodeAgentCapability({
  systemPrompt: { type: "preset", preset: "claude_code", append: "Commit your work." },
});
createClaudeCodeAgentCapability({ systemPrompt: "" });

// @ts-expect-error -- not a prompt shape the SDK accepts
claudeCodeAgent({ systemPrompt: { text: "You are a narrow agent." } });
// @ts-expect-error -- the only preset is Claude Code's own
claudeCodeAgent({ systemPrompt: { type: "preset", preset: "another" } });
// @ts-expect-error -- `append` is text
createClaudeCodeAgentCapability({ systemPrompt: { type: "preset", preset: "claude_code", append: 1 } });
