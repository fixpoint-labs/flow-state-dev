---
"@flow-state-dev/workforce": minor
---

Channels are removed (FIX-1792, FIX-1748): `CHANNEL.md`, `channelFlow`, `openChannels`, `readChannelsDirectory`, `channelBoard`, `channelInstances`, the channel and membership inventory collections (`defineChannelInventoryCollection`, `defineMembershipIndexCollection`), and `fsdev gen`'s channel slot are gone. A coordinator is a `WORKER.md` on the `coordinator` flow. Start from an empty store: a store written with channel rows does not open.
