---
"@flow-state-dev/workforce": patch
---

Channels can be declared in files: `readChannelsDirectory(root)` on the `@flow-state-dev/workforce/loader` subpath reads `teams/<id>/channels/<name>/CHANNEL.md` into one `ChannelManifest` each, which is what `channelInstances` and `openChannels` already take (FIX-1352). A channel is a folder with a fixed file in it, the way a worker is, and its id is minted from the two folder names — so a `system:` in frontmatter is refused by name rather than carried, because whether a channel is a system channel follows from where it was declared. Failures are collected under the path they were seen at, keyed by kind, so one bad folder never costs an app its other channels.
