---
"@flow-state-dev/workspace": patch
---

Child processes the workspace starts no longer inherit the host's whole environment. A setup command, a project check (`runCheckoutCommands`, and harness-manager's `commandCheck`), and `run`/`runToEnd` now start from an allowlist: `PATH`, `HOME`, the shell's own variables, locale, proxy and CA settings (`WORKSPACE_BASE_PASS`), plus whatever the caller sets in `env`. A secret such as `GITHUB_TOKEN` or a model gateway key reaches one only when the host names it. A setup that needs a variable, a private registry token say, passes it in `setup.env`.

The host's own git starts with its git settings (`HOST_GIT_PASS`: `GIT_CONFIG_GLOBAL`, the `GIT_CONFIG_COUNT` pairs, identity), and only its remote calls (fetch, push, `ls-remote`, `gh`) get credentials (`HOST_REMOTE_PASS`: `GH_TOKEN`, `GITHUB_TOKEN`, `SSH_AUTH_SOCK`, gh's config), so landing and fetching work as before. `run` and `runToEnd` take `pass`, names to pass from the host's environment, and the three lists are exported.
