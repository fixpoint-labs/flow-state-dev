---
"@flow-state-dev/workspace": patch
---

`checkCommandsFrom(value, setting)` reads a host's checks from one `;`-separated setting, such as an environment variable: each command trimmed, blanks dropped, and each checked with `checkoutCommandProblem`. It returns `undefined` when the value names no command, and throws `<setting>: <problem>` for the first command that would need a shell.

Docs: packages/workspace/README.md (`checkCommandsFrom` beside `checkoutCommandProblem`, with the `;`-separated form and the error's setting prefix)
