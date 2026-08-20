---
"@flow-state-dev/fsdev": minor
---

Tools that wire FSD into a project can now print the same closing paragraph from one authored source (FIX-1159). `@flow-state-dev/fsdev` exports `CANONICAL_NEXT_STEPS` — one text with a `mounted-route` branch and a `second-process` branch, plus named placeholders for the package manager's command forms, the host's own dev script and URL, and the path the mount answers on — along with `renderNextSteps` to fill it in and `assertCanonicalNextSteps` for a tool to prove its embedded copy has not drifted.

`renderNextSteps` throws rather than printing an unfilled placeholder, so a project whose dev script was renamed or moved to another port never gets handed a command it cannot run.

Command forms are measured rather than assumed. `npm exec` and `yarn exec` both swallow a leading-dash argument as their own configuration, so both render the `--` separator: without it, `fsdev serve --host 127.0.0.1` reaches the CLI as `serve 127.0.0.1` and the loopback bind silently never happens. pnpm needs no separator.
