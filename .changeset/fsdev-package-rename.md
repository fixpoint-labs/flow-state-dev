---
"fsdev": minor
---

The CLI package is now published as `fsdev` (previously `@flow-state-dev/cli`), so the package name and the command you type are the same string (FIX-1191). A zero-install run is `npx fsdev …` and installing it is `pnpm add -D fsdev`.

**This is a hand-swap: there is no compatibility path.** The old name is not re-exported, aliased, or deprecated-but-working — `@flow-state-dev/cli` simply will not resolve. If you pin it in a lockfile you must change the dependency yourself; nothing will do it for you and nothing will warn you at install time.

```diff
-"@flow-state-dev/cli": "^0.0.0"
+"fsdev": "^0.0.0"
```

Library imports move with it: `import { discoverFlows } from "fsdev"`.

The `fsdev` command itself is unchanged — same subcommands, same flags, same behaviour. Only the name you install and import changes.
