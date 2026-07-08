---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/tools": minor
---

Upgrade the generator provider layer from AI SDK 6 to AI SDK 7 (`ai@^7`, paired `@ai-sdk/*` majors, `@ai-sdk/mcp@^2`). Framework APIs and flow behavior are unchanged: streaming text/reasoning/tool deltas, structured output, multi-step tool loops, prompt caching, and model fallback all work as before. Requires Node.js 22+. Consumers using the escape hatches (`wrapAiSdkModel`, `providerTools`, raw provider model instances) must bump their own `ai` / `@ai-sdk/*` dependencies to the v7 majors. MCP transports now reject HTTP redirects by default (the `@ai-sdk/mcp@2` default; point transports at the direct URL if your server redirects).
