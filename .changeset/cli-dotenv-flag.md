---
"@flow-state-dev/cli": minor
---

Add a `--dotenv <path>` flag to `fsdev run`, `fsdev dev`, and `fsdev benchmark` for loading a specific `.env` file. The CLI already auto-loads `.env.local` by walking up from the working directory, but the walk-up only climbs — so running from a monorepo root never reaches an app's `.env.local` one level down. `--dotenv apps/my-app/.env.local` loads it explicitly. The flag is repeatable, resolved relative to cwd (absolute paths allowed), applied before the auto walk-up (so it outranks it), and never overwrites a value already in the real shell environment. A named file that doesn't exist is a hard error, unlike the silent walk-up.

The flag is named `--dotenv` rather than `--env-file` because Node 20.6+ and tsx reserve `--env-file` as a built-in flag and would intercept it before the CLI parsed its arguments under the `pnpm fsdev` (tsx) dev path.
