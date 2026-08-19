---
"@flow-state-dev/claude-code": minor
---

Rename the SDK agent's `sessionState` option to `detached`, inverting its sense:
`claudeCodeAgent({ sessionState: false })` becomes
`claudeCodeAgent({ detached: true })`. `createClaudeCodeAgentCapability` takes
the renamed option the same way.

The old name shadowed `sessionStateSchema` — the framework primitive it
suppresses, used six times in the same file — so the option was named after the
thing it turns off rather than after what it does. `detached` is the vocabulary
the option's own documentation already used, it is an adjective so it reads
correctly as a boolean, and it states the unusual mode positively instead of as a
double negative.

Migration: replace `sessionState: false` with `detached: true`. There is no
alias. An options object literal that still names `sessionState` is a type error
(excess-property check), so direct calls cannot slip through silently — but a
call that builds its options indirectly and spreads them in is not checked, so
re-check those by hand. Omitting the option still means an in-session agent that
keeps its conversation state, exactly as before.
