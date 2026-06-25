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
- If they said something like "all issues ready for dev" or "anything that has a reviewed spec", use Linear MCP tools (`list_issues` with the appropriate state filter) to find them. If the filter returns more than 2 issues, defer the batch-selection decision to Step 2.5 (interactive interview) instead of free-form confirmation.
- For each ID, run `get_issue` with `includeRelations: true` to confirm it exists and pull state, labels, and attached documents.

### Step 2: Classify each issue

For each resolved issue:

1. Read its current workflow state (`state.name`).
2. Check whether a spec document is attached (`get_document` on each attached document; the spec is typically titled `{ISSUE-ID}: ... — Implementation Spec`).
3. Decide the action per the table above.
4. If the action is "skip", record the reason — you'll report it in the summary.
5. If the action is ambiguous (e.g., state is "Todo" but a spec doc already exists, or state is "Ready for Dev" but no spec doc is attached), record it for **Step 2.5** — do not silently skip, do not guess, and do not surface as a free-form question.
6. For any issue you plan to dispatch as `implement-issue`, scan the attached spec for explicit unresolved markers — sections titled `Open Questions`, lines beginning with `TBD`, `TODO`, or `?`. Record each as a question for Step 2.5. The remote agent runs autonomously and cannot pause to ask you.
7. If the issue has neither a `Bug` nor `Feature/Enhancement` label and you're dispatching `implement-issue`, record the routing choice for Step 2.5 — `fsd:implement-issue` needs one of those labels to pick a discipline.

### Step 2.5: Resolve open questions interactively

If Step 2 surfaced any open questions — ambiguous state, batch selection, missing labels, unresolved spec markers — interview the user with the `AskUserQuestion` tool **before** building any prompts. Do not dump open questions into a final summary, do not ask in free-form prose, and do not pick silently.

Each question must:

- Offer **2–4 concrete, mutually exclusive options** — no "other" (the tool adds that automatically).
- Carry a **single recommendation** as the first option, with `(Recommended)` appended to its label.
- Have each option backed by what you'd actually do if the user picked it (no vague "investigate further").
- Use a short `header` chip (≤12 chars) like `Routing`, `State conflict`, `Spec gap`.

Send multiple independent questions in a **single** `AskUserQuestion` call (the tool accepts up to 4). Sequence them across calls only when one answer changes the next question's options.

**Examples:**

> **Ambiguous Linear state**
> *Question:* `FIX-648 is in "Todo" but already has a spec document attached. How should I dispatch it?`
> Options:
>   - `Dispatch implement-issue (use existing spec) (Recommended)` — Linear state is stale; the spec is the source of truth.
>   - `Dispatch create-spec (replace existing)` — the existing spec is outdated or wrong.
>   - `Skip — I'll fix Linear state first` — move it to "Spec Approved" manually, then re-run dispatch.

> **Batch selection**
> *Question:* `Found 7 issues in "Spec Approved". Dispatch which?`
> Options:
>   - `Dispatch all 7 (Recommended)` — they all match the criteria you named.
>   - `Dispatch top 3 by priority` — limit blast radius for this batch.
>   - `Show the list and let me pick` — I'll enumerate them so you can name specific IDs.

> **Routing label missing**
> *Question:* `FIX-712 has no Bug or Feature/Enhancement label. How should I route the implementation?`
> Options:
>   - `Label as Bug and dispatch (Recommended)` — the issue describes a regression.
>   - `Label as Feature and dispatch` — it's net-new behavior.
>   - `Skip — clarify scope first`.

> **Unresolved spec question**
> *Question:* `FIX-720's spec says "Open question: should retries use exponential or linear backoff?". What's the answer to inline into the dispatch prompt?`
> Options:
>   - `Exponential backoff (Recommended)` — matches the existing convention in `packages/engine/src/retry.ts`.
>   - `Linear backoff` — match the legacy behavior the spec is replacing.
>   - `Defer — skip this issue` — don't dispatch until the spec is updated.

Your recommendation must be grounded in evidence you can name (Linear state, spec content, codebase convention, prior user direction) — not just "this seems most common". If you genuinely have no basis to recommend, mark all options equally and say so in the question text.

Once every open question is answered, inline the resolutions into the prompt you build in Step 3 (e.g., "User confirmed: use exponential backoff" or "User confirmed: bug routing"). Then proceed.

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

The dispatching session has already resolved open questions in the spec (with the user) before sending this prompt — any clarifications they confirmed are inlined above under "User confirmations".

If despite that you still hit a genuinely unresolved ambiguity (the spec is missing, contradicts itself, or names a constraint that no longer holds), do NOT guess and do NOT proceed. Halt, post a comment on the Linear issue describing exactly what's blocked and what answer you'd need, leave the issue in its current state, and exit. The dispatching user will see the comment and either fix the spec or re-dispatch with explicit confirmations.
```

Substitute `{ISSUE_ID}` with the uppercase Linear ID (e.g. `FIX-123`) and `{issue_id_lower}` with the lowercase form (e.g. `fix-123`).

### Step 4: Dispatch each task

**Transport: `claude --remote` only — through the wrapper script.**

- ✅ `node .claude/skills/dispatch-remote/dispatch.mjs <<'EOF' … EOF` (the wrapper around `claude --remote`)
- ❌ `claude agents …` — that's the local background-agent CLI; it does not create cloud remote sessions
- ❌ `RemoteTrigger` tool — not used for this skill
- ❌ Calling `claude --remote` directly from the Bash tool — claude only prints the dispatch banner ("Created remote session: …", "View: …", "Resume with: …") when stdout is a TTY. From a normal subprocess stdout is a pipe, claude auto-engages `--print` mode, the banner is suppressed, and the call errors with "Input must be provided … when using --print" because `--remote` already consumed the positional argument. The wrapper runs claude under `script(1)` to allocate a pseudo-terminal so the banner is emitted and parseable.

Note: `claude --remote` is a working flag even though it does not appear in `claude --help`. Don't be misled by its absence from the help output — it is the correct transport.

The wrapper scrubs the env, disconnects stdin, parses the CLI output, and returns JSON:

```bash
node .claude/skills/dispatch-remote/dispatch.mjs <<'EOF'
<PROMPT_FROM_STEP_3>
EOF
```

The heredoc on **stdin** (not as an argv) avoids shell-quoting issues with backticks, quotes, and newlines in the prompt. The script prints a single JSON line on stdout:

- Success: `{"ok":true,"sessionId":"session_...","url":"https://claude.ai/code/...","name":"...","raw":"..."}`
- Failure: `{"ok":false,"error":"...","raw":"..."}`  (non-zero exit code)

Dispatch sequentially — the local dispatch is sequential; remote tasks run in parallel on Anthropic's side. After each call, parse the JSON, record `sessionId` and `url`, and only treat the dispatch as successful when `ok` is `true`.

If the script reports a parse failure or non-zero exit, **do not** report the dispatch as successful. Surface the raw CLI output to the user and ask before retrying.

### Step 5: Summary

Report back to the user:

- **Dispatched** — one line per issue: `{ISSUE-ID} — {create-spec | implement-issue} — {remote task URL or ID}`
- **Skipped** — one line per issue with the reason (already in flight, done, user chose to skip during Step 2.5, etc.)

By design there should be no "pending user input" section at this point — Step 2.5 resolves open questions interactively before dispatch. If anything genuinely couldn't be resolved (e.g., the user picked "skip — clarify scope first" for an issue), record it under **Skipped** with the user's reason, not as a dangling question.

Remind the user: remote tasks run independently. They update Linear themselves, post the spec or PR link to the issue when ready, and respond to PR review comments asynchronously. You will not get a callback in this conversation when they finish — check Linear or GitHub for status.

## Guidelines

- **Don't do the work yourself.** This skill dispatches; it does not author specs or write code. If you find yourself reading source files to understand an issue, stop — that's the remote agent's job, not yours.
- **Self-contained prompts.** The remote agent has no access to this conversation. If you catch yourself writing "as discussed" or "the issue we just looked at", rewrite to inline the context.
- **Linear is the source of truth for state.** Don't infer "ready for dev" from chat ("the user said this one's reviewed"). Read the issue state via `get_issue`. If the user disagrees with what Linear says, fix Linear first, then dispatch.
- **One issue per remote task.** No batching, no multi-issue prompts. Each remote task owns one branch and one PR.
- **Skipped silently means lost work.** If you skip an issue, tell the user why in the summary. Better to over-report than to lose a dispatch.
- **Always go through the wrapper script.** Never invoke `claude --remote` directly from Bash inside a claude session — the dispatch banner is only printed when stdout is a TTY, and a subprocess pipe is not. The wrapper allocates a pseudo-terminal via `script(1)` so the banner is emitted and parseable. Use `node .claude/skills/dispatch-remote/dispatch.mjs <<'EOF' … EOF`.
- **Resolve open questions with `AskUserQuestion`, not free-form prose.** Anything ambiguous — batch selection, state conflicts, missing labels, unresolved spec questions — goes through Step 2.5 with 2–4 concrete options and a recommendation. Free-form "what do you want me to do?" loses momentum and forces the user to write a paragraph; structured options let them click.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Building the prompt by string-interpolating user chat context | Inline the relevant context as plain prose; the remote agent can't see chat |
| Calling `claude --remote "..."` directly from Bash | Use `node .claude/skills/dispatch-remote/dispatch.mjs <<'EOF' … EOF` — the wrapper runs claude under `script(1)` so stdout is a PTY and the dispatch banner is printed (otherwise `--print` mode auto-engages and the banner is suppressed) |
| Reaching for `claude agents` because `claude --help` doesn't list `--remote` | `--remote` is a hidden but working flag; `claude agents` is the local background-agent surface, not the cloud dispatch path. Always go through the wrapper script. |
| Reaching for the `RemoteTrigger` tool | Not used here. This skill dispatches exclusively via the `claude --remote` wrapper script. |
| Embedding unescaped quotes or backticks in the prompt | The wrapper takes the prompt on stdin via heredoc — no shell escaping needed |
| Reporting "dispatched" when `ok` was `false` in the script JSON | Only treat `{"ok":true}` as success; surface anything else to the user |
| Forgetting to mention `LINEAR_API_KEY` in the prompt | The cloud env has the key, but the prompt must tell the agent it can use Linear |
| Dispatching an issue already in "In Development" or "In Spec Dev" | Causes a duplicate branch / duplicate spec; classify state first |
| Combining "implement these 3 issues" into one prompt | Each issue needs its own branch and PR — dispatch separately |
| Dispatching `fsd:create-spec` for a bug with a clean reproduction | Bugs can often skip spec creation (per `fsd:implement-issue` Step 2); dispatch implementation directly and let the diagnose discipline build the reproduction |
| Reporting "dispatched" when the wrapper command actually errored | Capture the CLI exit code and stdout; only report success on a clean exit |
| Dumping unresolved ambiguity into the final summary instead of asking before dispatching | Resolve via Step 2.5 with `AskUserQuestion`, 2–4 options, and a recommendation. The summary is for outcomes, not deferred decisions. |
| Asking a free-form question ("how should I handle this?") instead of structured options | Translate every open question into a choice between 2–4 specific actions, with one marked `(Recommended)` |
