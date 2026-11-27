# FIX-2933 · Decisions

[Spec](SPEC.md) · **Decisions**

## D1 · The helper is `localRepoWorkspaceHost`, and it returns a plain `WorkspaceHost`

**The call.** Name it after what it returns, beside `localWorkspaceHost`. The issue's working
name, `localRepoWorkspace`, reads as a workspace value, which the package does not have.

**Options:** `root`, `repo`, `baseRef?`, `setup?`, `pullRequestRepo?`, `provisionTimeoutMs?`,
`now?`. Exactly the fields today's copies and `WorkspaceConfig` pass, nothing more.

**If wrong:** a rename later, with no alias (ER-6).

## D2 · A host whose source is not one fixed repository keeps `localWorkspaceHost`

The helper covers one case. A host that picks a source per session, or lists several
repositories, calls `localWorkspaceHost` directly. Widening the helper to cover them would make
it a second spelling of `localWorkspaceHost`'s options.
