---
"@flow-state-dev/core": patch
"@flow-state-dev/orchestration": patch
---

Add a `conversation` context-supply mode to delegation agents, re-introducing fork-like sub-execution: a declared agent can inherit the parent conversation up to the point it is dispatched, do its work, and hand back only its result — its own steps stay out of the host's context window.

- `@flow-state-dev/core`: `AgentSpec` gains an optional `contextSupply?: "isolated" | "conversation"`. Default (absent or `"isolated"`) is today's behavior — the agent sees only its task input. It is an input policy only; it does not touch the output axis (`itemVisibility.history`) or flow-policy / `priorWork`.
- `@flow-state-dev/orchestration`: `materializeWorker` honors `contextSupply` for inline (`prompt`/`prompt-ref`) agents by wiring the generator `history` slot to the parent conversation, **bounded by default** to the last several whole turns (via the real `ItemQuery.limit` shape, not the full history window). Output isolation is unchanged (`itemVisibility` still defaults to `{ client: true, history: false }`), so a conversation agent reads prior history but its steps never re-enter host history. The `agents:` frontmatter parser and serializer accept and round-trip a `context-supply:` sub-key. Setting `context-supply` on an `agent-ref` agent, or to an out-of-enum value, fails loud in both the parser and the materializer (the authoritative guard for programmatic/persisted specs). A conversation agent whose output is also history-visible warns at build time, since that defeats the isolation.
