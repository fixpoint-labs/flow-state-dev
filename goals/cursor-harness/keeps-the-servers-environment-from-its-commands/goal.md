# cursor-harness › it keeps the server's environment from its commands

**Issue:** FIX-1917 (V8, BR-23)
**Outcome:** A host runs Cursor with `env` set, and a shell command Cursor runs starts without a
secret the server holds: the variable is not in the command's own environment. The same host
without `env` hands every command the server's whole environment, which is what the option
exists to stop.
**Not claimed:** that a command cannot find the secret at all. `env` is not a security boundary:
the runtime's process runs as the server's OS user, so on Linux a command that goes looking can
still read the server's environment through `/proc/<pid>/environ`. A separate user or a
container is what contains that, and this goal does not test it.
**Input:** `fixtures/input.json` — the name of the planted variable and the model. The value is
a fresh random token per run, so no answer can be known ahead of the run. Held-out: any variable
name the host does not pass works the same way.
**Signal:** Two real Cursor runs, each told to run one shell command that prints the planted
variable:
- **c:control** — `env` unset: the run's items contain the token. This is what proves Cursor
  actually ran the command; without it, leg **f** could pass on a run that ran nothing.
- **f:fenced** — `env` set to `PATH`, `HOME` and `CURSOR_API_KEY` only: the run finished, a shell
  step ran, and the token appears nowhere in its items (the command printed its own environment's
  value, which is empty).
**Anti-game:** A fenced run that never ran a command would print nothing and pass **f**, so **f**
also requires a settled shell step, and **c** must pass for the verdict to count. The check reads
the run's own items (what the stream carried), never the model's prose about what it saw, and
never a scripted SDK.
**Model:** real Cursor — `composer-2.5`, on a host with `CURSOR_API_KEY`.
**Run:** `CURSOR_API_KEY=… pnpm tsx goals/cursor-harness/keeps-the-servers-environment-from-its-commands/run.mts`
**Controls:** `GOAL_CONTROL=ignore-env` runs the fenced leg with `env` unset; **f:fenced** must FAIL
(the token shows).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| — | — | — | NOT YET RUN | No `CURSOR_API_KEY` in the implementing session. The package's `env-fence.spec.ts` covers the mechanism in CI: the real child process, a scripted SDK that spawns its shell with `{ ...process.env }` as the real one does (red when the child inherits the server's environment), and the real installed SDK across the process boundary for a refused resume. A real model running a real command is what remains. |
