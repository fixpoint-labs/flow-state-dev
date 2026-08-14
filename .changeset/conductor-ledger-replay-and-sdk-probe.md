---
---

Internal (`@flow-state-dev/conductor`, private and unpublished): two fixes to
M0.

The ledger's headline invariant — *every transition is reproducible from the
ledger* — was not supported by the schema behind it. `ledgerEntryStateSchema`
now stores `decide`'s three arguments whole (`entityKind`, `signal`, `world`),
so a row replays literally instead of only proving no transition happened
outside a recorded action. All three are nullable, so a row written before them
reads back rather than failing (BP-030).

Dispatcher discovery probed for a `claude` binary on `PATH`, which stopped being
what the dispatcher needs when it moved to the Agent SDK. It now probes SDK
resolvability through the same resolver `@flow-state-dev/claude-code` loads it
with, so discovery and dispatch cannot disagree. Discovery failure still raises
`ConductorConfigError` naming `dispatcher`, with no silent default.

No public API surface changes.
