---
"@flow-state-dev/tools": minor
---

Bash sandboxes no longer leave processes and containers running after they are released (FIX-2678, FIX-2679).

- **Local provider:** releasing a sandbox stops every background job its commands started (SIGTERM, then SIGKILL after a 2-second grace). A job still outlives the command that started it, so the agent can start a server and use it in its next command. If your flow wires `bashCap.cleanupBlock` into `request.onFinished`, a background job now stops when the request finishes; a job started with `setsid` or as a daemon leaves its process group and is not stopped.
- **Idle release:** a sandbox no command has used for 30 minutes is released automatically, for every provider. Flows that never wire `cleanupBlock` are reaped too. The timer never holds the process open.
- **MOAT provider:** a persisting container (`persist` defaults to on) still survives `cleanupBlock`, but once idle for 30 minutes it is stopped and destroyed; the next command in that session starts a fresh container. A command that times out is now stopped inside the container, not only the host `moat` process. `moat exec` output is capped at 10 MB per stream, as the local provider's is; a command that overruns is stopped and returns exit code 1.

Docs: packages/tools/README.md (the persistent-containers paragraph: the cleanup block no longer means the container lives until `moat stop`; idle stop after 30 minutes; local background jobs stop on release or after 30 idle minutes), apps/docs/docs/tools/bash.md (the persistent MOAT section, "becomes a no-op" and "outlives the framework process" bullets; the exec-timeout bullet: the command inside the container is stopped too, and the 10 MB output cap; the local provider's background-job lifetime)
