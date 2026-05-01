---
sidebar_position: 9
---

# Agent types

`agentType` classifies generator output. It controls whether auto-emitted messages and reasoning go to the client, enter conversation history, or stay devtool-only.

| `agentType` | Client stream | Conversation history | Typical use |
| --- | :---: | :---: | --- |
| `"primary"` | Yes | Yes | User-facing assistant output. |
| `"sub"` | Yes | No | Worker output that should be observable but not become ambient history. |
| `"trace"` | No | No | Background observers, audits, and debug-only reasoning. |
| Unset | No auto-emitted items | No auto-emitted items | Structured transformers whose typed output flows only through block edges. |

```ts
const assistant = generator({
  name: "assistant",
  agentType: "primary",
  agentName: "assistant",
  model: "preset/medium",
  prompt: "Answer the user.",
});

const researcher = generator({
  name: "researcher",
  agentType: "sub",
  agentName: "researcher",
  model: "preset/medium",
  prompt: "Investigate one subtask.",
});
```

`agentName` separates identities within the same type. Parallel sub-agents can share one `agentName` to collaborate in one history slice, or use unique names to stay isolated.

Use `ctx.session.items.selectForContext()` when a coordinator needs a non-default slice of history, such as prior output from one sub-agent or trace items for diagnostics.

## Related pages

- [SSE protocol](/docs/streaming/items#generator-identity)
- [Items overview](/docs/streaming/overview#generator-identity-controls-conversational-visibility)
