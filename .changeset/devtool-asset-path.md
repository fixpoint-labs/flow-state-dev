---
"@flow-state-dev/devtool": minor
"@flow-state-dev/fsdev": patch
---

**Breaking:** `getAssetPath()` is renamed `getDevToolAssetPath()`, so the name no longer means two things across published packages (FIX-2449). `getAssetPath()` stays the name an app package exports for `fsdev dev --app`. No deprecated alias. `fsdev`'s optional peer on `@flow-state-dev/devtool` is now a caret range on this release, so an older DevTool no longer satisfies it.

Docs: packages/devtool/README.md (the `getAssetPath(): string` section and its example become `getDevToolAssetPath()`)
