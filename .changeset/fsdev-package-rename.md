---
"fsdev": minor
---

The CLI package is now published as `fsdev` (previously `@flow-state-dev/cli`). The package name and the command you type are the same, so a zero-install run is `npx fsdev …` and installing it is `pnpm add -D fsdev`.

The `fsdev` command itself is unchanged — same subcommands, same flags, same behaviour. Existing installs should swap the dependency name:

```diff
-"@flow-state-dev/cli": "^0.0.0"
+"fsdev": "^0.0.0"
```

Library imports move with it: `import { discoverFlows } from "fsdev"`.
