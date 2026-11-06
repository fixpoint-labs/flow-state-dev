---
"@flow-state-dev/devtool": minor
---

**Breaking:** `getAssetPath()` is renamed `getDevToolAssetPath()`, so the name no longer means two things across published packages (FIX-2449). `getAssetPath()` stays the name an app package exports for `fsdev dev --app`. No deprecated alias.

Docs: packages/devtool/README.md (the `getAssetPath(): string` section and its example become `getDevToolAssetPath()`)
