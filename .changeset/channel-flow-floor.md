---
"@flow-state-dev/workforce": minor
---

Add channels: a built-in `channel` flow kind plus the two-phase binder that opens one (FIX-1311).

One kind is one registered instance, and a channel is a named session on it, carrying its own members, charter and append-only transcript in session state. `channelInstances` returns the instances to register at build time — with the built-in seeded, so an app registers nothing to use channels — and `openChannels` opens one named session per record once the host is running. A custom kind goes in `channelInstances`'s `kinds` map.

Two limits are part of the contract rather than gaps. A channel session belongs to one user, so the server-derived `principal` is the same on every line of a transcript and the optional `author` label — stored with `authorVerified: false` — is the only thing distinguishing participants. And a flow-to-flow post needs in-process dispatch: on a host whose dispatcher hands work to an external queue it refuses `external-dispatcher`, while client posts through the action route are unaffected.
