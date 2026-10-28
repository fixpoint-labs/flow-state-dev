---
"@flow-state-dev/cursor": patch
---

A sandboxed run (`agent.local.sandboxOptions.enabled`) with `env` set now finds Cursor's sandbox helper under pnpm, where it failed with "sandboxing is not supported in this environment" on hosts that support it: the package depends on Cursor's platform packages. New `probeCursorSandbox({ cwd, env })` asks the SDK whether the sandbox can start, without starting a run (FIX-1950).
