---
"@flow-state-dev/core": minor
"@flow-state-dev/claude-code": minor
"@flow-state-dev/cursor": minor
"@flow-state-dev/codex": minor
"@flow-state-dev/workspace": minor
"@flow-state-dev/workforce": minor
---

Coding agents can act on GitHub as an account of their own instead of as the user whose machine runs them. Nothing changes for a host that sets none of these.

- **`gitHubAccountEnv({ token, name, email })`** (`@flow-state-dev/core/harness`) builds the variables that make a run's git and `gh` act on github.com as that account: `GH_TOKEN` and `GITHUB_TOKEN`, the commit author and committer, github.com's credential helpers replaced by one that answers with the token, and `git@github.com:` / `ssh://git@github.com/` remotes reached over https so the user's ssh key isn't used. `GH_TOKEN_CREDENTIAL_HELPER` is that helper. `gitHubAccountFrom(settings, names)` reads an account from three named settings, all or none, and throws naming the missing ones when only some are set.
- **`extraEnv`** on `claudeCodeHarness`, `cursorHarness` and `codexHarness`: variables set on every run over the harness's pass-list, such as `gitHubAccountEnv(account)`.
- **`pullRequestsAs: { token }`** on `localWorkspaceHost` and `localRepoWorkspaceHost`: `land` pushes a run's branch to its pull request's repository over https with that token, and `gh` opens the pull request with it. github.com only: a pull request whose repository is on any other host is refused as `pull-request-host` before anything is pushed or `gh` starts. A local merge is unchanged.
- **`agentToken`** on `operatorGitHub`: a subscription's self is the account that token belongs to, so the own screen drops the agents' comments and hears the operator's. Reads still use the operator's token. A follow saved before this keeps the self it was saved with.

Docs: packages/core/README.md and apps/docs/docs/concepts/coding-harnesses.md (`gitHubAccountEnv` beside `harnessEnv`; a host giving its agents their own GitHub account) · packages/claude-code, cursor and codex READMEs and apps/docs/docs/catalog/harnesses/ (`extraEnv`) · packages/workspace/README.md (`pullRequestsAs`) · packages/workforce/README.md (`operatorGitHub`'s `agentToken`) · apps/docs/docs/catalog/starters/teammates.md (the `TEAMMATES_AGENT_*` settings and adding the operator to the trusted reviewers)
