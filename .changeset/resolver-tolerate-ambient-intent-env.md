---
"@flow-state-dev/core": patch
---

`createModelResolver`: an `FSDEV_INTENT_<NAME>` env var that names an intent the resolver doesn't declare is now **warned-and-skipped instead of throwing at construction**. Env vars are ambient, so a shared or CI/automation environment that pins an intent override for some *other* app would previously crash any app that didn't declare that intent. An app's `fsdev.config.*` model wiring stays authoritative; the inapplicable override is ignored with a one-time dev warning. (A typo in an intent the app *does* declare still surfaces as a warning, and invalid values for a declared intent still throw.) This removes the need for `FSDEV_INTENT_*` env-stripping in headless runners.
