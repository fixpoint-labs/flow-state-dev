# FIX-150 — throwaway POCs. Not production. Never merged.

Six probes built while writing [`spec/FIX-150.md`](../../spec/FIX-150.md). Each one settles a
premise the spec rests on, against the **real** Claude Agent SDK and a real model — not a
mock. Their verdicts are recorded in the spec's §12 as settled claims.

**These are not a design.** They are the smallest thing that makes each premise falsifiable.
Do not review them as code: quality here is not a finding
([`spec-template.md`](../../docs/contributing/spec-template.md) → "How to review this"). If you
think a *verdict* is wrong, run the probe.

## Running these

```bash
cd spec-poc/FIX-150-workspace-projection
npm install --prefix . @anthropic-ai/claude-agent-sdk   # gitignored; not a workspace package
node ./poc-1-cwd.mjs                                    # …and so on, 1 through 6
```

Each script prints its measurements and then a `VERDICT:` line. They cost a few model calls
each and take 10–60s. `poc-5` additionally needs `bubblewrap` and `socat` on Linux
(`apt install bubblewrap socat`) — without them its probe B is skipped by the SDK's own
fail-closed guard, which is itself part of what it measures.

Every probe writes into `mkdtemp` directories and cleans up after itself.

## What they measured

| # | Question | Verdict | Evidence |
|---|---|---|---|
| 1 | Does pointing a run at a directory actually relocate its filesystem? | **CONFIRMED** | Seeded file read from the temp dir, output written there, host directory delta empty. |
| 2 | Is the SDK's worktree machinery a third placement strategy? | **REFUTED** | Built-in `--worktree` is git-only and picks its own path. `WorktreeCreate` *is* host-implementable — returning a path relocates the run into any directory, git or not — but it only fires when the **model** calls `EnterWorktree`. Not a placement the framework can choose. |
| 3 | Do in-process hooks fire, and does end-of-turn have room to flush? | **CONFIRMED** | Per-tool hook fired 3×; a 3,605 ms flush inside `Stop` ran to completion before the result. `SessionEnd` never fired. |
| 4 | Can hook observation alone drive flush? | **REFUTED** | `PostToolUse` carried `file_path` for `Write`, only a `command` string for a `Bash` heredoc. `FileChanged` never fired. A content diff found both files. |
| 5 | Is the working directory a containment boundary? | **REFUTED** (and a fix confirmed) | An unconfigured run wrote outside it. `sandbox.filesystem.allowWrite` scoped to the workspace refused the same write. `CwdChanged` never fired; the shell reported *"cwd was reset"* — `cd` does not persist between tool calls. |
| 6 | Does omitting `settingSources` isolate the run? | **REFUTED** | Omitted → the workspace's own `CLAUDE.md` **and** `.claude/settings.json` were both honoured. `[]` → neither. The safe default is not the absent one. |

Two incidental findings worth carrying into implementation, both from failed first attempts:

- **`permissionMode: "bypassPermissions"` is refused when the process runs as root** —
  *"--dangerously-skip-permissions cannot be used with root/sudo privileges"* — which is the
  shape of a server container. A `canUseTool` callback is the programmatic equivalent that
  works. Every probe here uses it.
- **A `Write` with a bare relative path can resolve outside the workspace.** During probe 4's
  first run the model resolved `artifacts/via-write.md` to `/artifacts/via-write.md` — the
  filesystem root — and the write succeeded. That is what prompted probe 5.

## Files

`lib.mjs` — temp workspaces, a content-hash snapshot/diff (standing in for the projection's
own change detection), and the allow-all approval callback. `smoke.mjs` — a connectivity
check, kept so a reader can tell an SDK/auth problem from a real refutation.
