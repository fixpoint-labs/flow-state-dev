---
"@flow-state-dev/fsdev": minor
---

The CLI package is now published as `@flow-state-dev/fsdev`, renamed from `@flow-state-dev/cli` (FIX-1191). The package name now matches the command it installs, and it frees `@flow-state-dev/cli` for a future consumer-facing CLI surface.

**This is a hand-swap: there is no compatibility path.** The old name is not re-exported, aliased, or deprecated-but-working — `@flow-state-dev/cli` simply will not resolve. If you pin it, you must change the dependency yourself; nothing will do it for you and nothing will warn you at install time.

```bash
pnpm remove @flow-state-dev/cli
pnpm add -D @flow-state-dev/fsdev
```

Library imports move with it: `import { discoverFlows } from "@flow-state-dev/fsdev"`.

**The `fsdev` command is unchanged** — same name, same subcommands, same flags, same behaviour. The command comes from the package's `bin` key, not from its package name, so `fsdev …` after an install, `pnpm fsdev …`, and `"dev": "fsdev serve"` in your scripts all keep working exactly as before. Only the string you install and import changes.
