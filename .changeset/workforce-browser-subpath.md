---
"@flow-state-dev/workforce": patch
---

New `@flow-state-dev/workforce/browser` subpath for client components: `HIRED_ROSTER_RESOURCE`, `SEAT_INVENTORY_RESOURCE`, `splitSeatAddress`, `CHANNEL_POST_COMPONENT`, `channelTranscriptLineSchema` and `ChannelTranscriptLine`. It reaches no Node built-in. The package root is server code (the channel floor reaches `node:async_hooks` through the task board), so a browser component that imported one of these from the root could fail to compile (FIX-1605).
