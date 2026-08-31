---
"@flow-state-dev/engine": minor
"@flow-state-dev/core": minor
"@flow-state-dev/fsdev": minor
"@flow-state-dev/testing": patch
---

Send a message to a session that is already running.

A session now has an address — the id it already has — and `ctx.requestHost.sendMessage({ to, kind, payload, mode: "fireAndForget" })` reaches it. The message arrives as an ordinary request on the recipient and shows up in that session's history like anything else, so the recipient's next turn can act on it. The call resolves once the system has accepted the delivery, and hands back the delivery's request id.

A flow declares what it accepts with a new `relay` group, a sibling of `webhooks`:

```ts
defineFlow({
  kind: "conductor",
  relay: { on: { question: { block: answerQuestion, input: (m) => m.payload } } }
})
```

Who may send is decided by the server from the sending context, never from anything written in the message. A flow with no `relay` group behaves exactly as before.

Generators reach the same verb through `relaySendTool()`, which an author adds to a generator's `tools` — so the capability is scoped by declaration rather than available everywhere.

Two supporting changes come with it:

- **A tool's own `config.retry` and `config.timeoutMs` now apply.** `config.retry` merges over `tools.defaults.retry` (block wins field by field, matching every other execution path), and `config.timeoutMs` overrides `tools.defaults.timeoutMs` for that tool alone. `config.retry` was previously declared and silently ignored on the tool path.
- **Session records carry a session kind.** Records written before this release do not, and messaging refuses them rather than guessing. Run `fsdev migrate session-kind` once to classify them.

Waiting for a reply (`mode: "waitForResponse"`) is not available yet and is refused by name.
