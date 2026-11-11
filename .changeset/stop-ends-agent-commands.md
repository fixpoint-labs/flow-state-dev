---
"@flow-state-dev/claude-code": patch
"@flow-state-dev/cursor": patch
---

Stopping a coding-agent run now ends the commands the agent started, not only the agent's own process (FIX-2671). Before, a stopped run (an abort, a deadline, a steer, a held tool approval) could leave a `tsc`, a test worker, a dev server or an install the agent was running in the background, holding its memory.

- `claudeCodeAgent`: off Windows the Claude Code process runs in its own process group. The SDK's abort-time `SIGTERM` and the block's `SIGKILL` after `abortExitGrace` go to the whole group.
- `cursorAgent` with `env` set: off Windows the runtime's child process runs in its own process group. When a cancelled run is closed, the group gets `SIGTERM` at once and `SIGKILL` after the existing 10s close grace. A run that finishes normally is closed the way it was before.
- These processes no longer receive a terminal's Ctrl-C aimed at the server. They still exit when the server exits: Claude Code when its stdin closes, Cursor's child when its IPC channel closes.
- Windows: unchanged. The signals reach the agent's process alone.
- Codex (`@flow-state-dev/codex`) is unchanged. Its SDK spawns the CLI itself and exposes no process to signal.

Docs: none needed beyond the JSDoc on `abortExitGrace`, `claudeCodeAgent` and the Cursor child runtime.
