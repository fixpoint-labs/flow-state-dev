---
name: fsd:dispatch-remote
description: Use when the user asks to dispatch, kick off, run remotely, or orchestrate work on one or more Linear issues — routes each issue to the right cloud Claude task (`fsd:create-spec` or `fsd:implement-issue`) based on its Linear state. Trigger phrases include "dispatch FIX-123", "kick off work on", "run create-spec remotely for", "orchestrate these issues".
argument-hint: "<Linear issue ID(s), e.g. FIX-123, FIX-124>"
---

You are an orchestration agent. Given one or more Linear issues, dispatch the right work to remote Claude tasks so they run autonomously in the cloud, submit PRs where applicable, and respond to PR review comments.

## Core Principles

**Remote tasks are autonomous workers, not callable functions.** Each remote dispatch spins up a fresh Claude session with no memory of this conversation. The prompt you send must be self-contained: it must name the skill to invoke, the Linear issue ID, and any context the remote agent needs to start.

**Linear state determines which skill the remote task runs.** This skill does not author specs or implement code itself. It reads each issue's state and routes:

| Linear state                          | Action                                              |
| ------------------------------------- | --------------------------------------------------- |
| Todo / Backlog, no spec attached      | Dispatch `fsd:create-spec`                          |
| In Spec Dev                           | Skip — spec work already in flight                  |
| Spec Approved / In Spec Review        | Dispatch `fsd:implement-issue`                      |
| In Development / In Review            | Skip — implementation already in flight             |
| Done / Cancelled                      | Skip — nothing to do                                |
| Ambiguous (e.g. pre-spec state but a spec doc is already attached) | Ask the user to pick |

**One issue, one remote task.** Each remote dispatch handles exactly one Linear issue. For batches, dispatch separately. Do NOT combine multiple issues into a single remote prompt — they'd share a branch and a PR, and `fsd:implement-issue` is built around `fix/{ISSUE-ID}` branches.

**You don't run the skills locally.** If the user says "just run create-spec here", that's a different request — point them at `/fsd:create-spec` and stop. This skill exists to hand work to remote workers, not to do the work in-process.

## Workflow

### Step 1: Resolve the issue list

- If the user named explicit issue IDs in $ARGUMENTS, use those.
- If they said something like "all issues ready for dev" or "anything that has a reviewed spec", use Linear MCP tools (`list_issues` with the appropriate state filter) to find them, then present the list and confirm before dispatching.
- For each ID, run `get_issue` with `includeRelations: true` to confirm it exists and pull state, labels, and attached documents.

### Step 2: Classify each issue

For each resolved issue:

1. Read its current workflow state (`state.name`).
2. Check whether a spec document is attached (`get_document` on each attached document; the spec is typically titled `{ISSUE-ID}: ... — Implementation Spec`).
3. Decide the action per the table above.
4. If the action is "skip", record the reason — you'll report it in the summary.
5. If the action is ambiguous (e.g., state is "Todo" but a spec doc already exists, or state is "Ready for Dev" but no spec doc is attached), surface the conflict to the user and let them pick.

### Step 3: Build the remote prompt

For each issue you're dispatching, build a self-contained prompt using the template below. The remote agent only sees what you put in the prompt; it has no access to this conversation or to the local repo state.

**Template — spec authoring:**

```
Invoke the `fsd:create-spec` skill for Linear issue {ISSUE_ID}.

Linear access: the `LINEAR_API_KEY` environment variable is available in this
cloud environment. Use the Linear MCP tools normally — `get_issue`,
`list_comments`, `get_document`, `save_issue`, `create_document`,
`update_document`.

The skill will:
  - Pull the issue and any attached documents
  - Research the problem (codebase + industry)
  - Run the Step 3.5 Necessity check
  - Draft and validate the spec
  - Attach it to the issue as a Linear document
  - Move the issue through "In Spec Dev" → "In Spec Review"

If the Necessity verdict is anything other than "Build as scoped", post the
case to Linear as a comment per the skill's Step 3.5 instructions and STOP.
Do not draft a spec for an issue the user has not agreed to scope.

Do NOT open a PR — spec authoring lives in Linear, not in the repo.
```

**Template — implementation:**

```
Invoke the `fsd:implement-issue` skill for Linear issue {ISSUE_ID}.

Linear access: the `LINEAR_API_KEY` environment variable is available in this
cloud environment. Use the Linear MCP tools normally.

The skill will:
  - Pull the issue and its attached spec document
  - Branch as `fix/{issue_id_lower}` off main
  - Route by Linear category label: Bug → `fsd:diagnose`,
    Feature/Enhancement → `fsd:tdd`
  - Implement, run review sub-agents, commit, push, and open a PR
  - Update the Linear issue state and attach the PR URL

After the PR is open, respond to PR review comments as they arrive: read each
comment, decide whether it requires a code change or just a reply, and act
accordingly. If a reviewer requests a change you disagree with, push back with
reasoning rather than blindly applying it.

If the spec is missing or open questions in the spec are unresolved, Do not guess what to do, instead ask the user any questions necessary to clarify ambigious concerns and open questions. Do not make assumptions about things, clarify with user as necessary. 
```

Substitute `{ISSUE_ID}` with the uppercase Linear ID (e.g. `FIX-123`) and `{issue_id_lower}` with the lowercase form (e.g. `fix-123`).

### Step 4: Dispatch each task

For each issue, run `claude --remote` with the prompt:

```bash
claude --remote "$(cat <<'EOF'
<PROMPT_FROM_STEP_3>
EOF
)"
```

The heredoc avoids quoting issues with multi-line prompts containing backticks, quotes, or shell metacharacters. Dispatch sequentially — the local dispatch is sequential; the remote tasks themselves run in parallel on Anthropic's side.

After each dispatch, capture and record whatever the CLI prints (task ID, URL, or session identifier). You'll report these in the summary.

**If `claude --remote` is not the correct invocation in this environment**, stop and ask the user for the right command before dispatching anything. The shape of the prompt doesn't change — only the wrapper. Common alternatives the user may use: a GitHub Action that triggers a cloud agent on issue label, the `/agents` view's "new background agent" flow, or a project-specific wrapper script. Confirm before dispatching; a wrong wrapper means the work doesn't happen and no one notices until later.

### Step 5: Summary

Report back to the user:

- **Dispatched** — one line per issue: `{ISSUE-ID} — {create-spec | implement-issue} — {remote task URL or ID}`
- **Skipped** — one line per issue with the reason (already in flight, done, ambiguous state, etc.)
- **Pending user input** — any issues you couldn't classify; list each with the conflict and the question you need answered

Remind the user: remote tasks run independently. They update Linear themselves, post the spec or PR link to the issue when ready, and respond to PR review comments asynchronously. You will not get a callback in this conversation when they finish — check Linear or GitHub for status.

## Guidelines

- **Don't do the work yourself.** This skill dispatches; it does not author specs or write code. If you find yourself reading source files to understand an issue, stop — that's the remote agent's job, not yours.
- **Self-contained prompts.** The remote agent has no access to this conversation. If you catch yourself writing "as discussed" or "the issue we just looked at", rewrite to inline the context.
- **Linear is the source of truth for state.** Don't infer "ready for dev" from chat ("the user said this one's reviewed"). Read the issue state via `get_issue`. If the user disagrees with what Linear says, fix Linear first, then dispatch.
- **One issue per remote task.** No batching, no multi-issue prompts. Each remote task owns one branch and one PR.
- **Skipped silently means lost work.** If you skip an issue, tell the user why in the summary. Better to over-report than to lose a dispatch.
- **Confirm the dispatch wrapper if uncertain.** `claude --remote` is what the user named, but if the CLI doesn't recognize it in this environment, do not guess — ask. The cost of a one-line confirmation is much smaller than the cost of a "dispatched" report that didn't actually dispatch anything.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Building the prompt by string-interpolating user chat context | Inline the relevant context as plain prose; the remote agent can't see chat |
| Embedding unescaped quotes or backticks in a `claude --remote "..."` call | Use the heredoc form shown in Step 4 |
| Forgetting to mention `LINEAR_API_KEY` in the prompt | The cloud env has the key, but the prompt must tell the agent it can use Linear |
| Dispatching an issue already in "In Development" or "In Spec Dev" | Causes a duplicate branch / duplicate spec; classify state first |
| Combining "implement these 3 issues" into one prompt | Each issue needs its own branch and PR — dispatch separately |
| Dispatching `fsd:create-spec` for a bug with a clean reproduction | Bugs can often skip spec creation (per `fsd:implement-issue` Step 2); dispatch implementation directly and let the diagnose discipline build the reproduction |
| Reporting "dispatched" when the wrapper command actually errored | Capture the CLI exit code and stdout; only report success on a clean exit |
