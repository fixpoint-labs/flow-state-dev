---
name: watch-pr
description: Stream new PR activity — comments, reviews (incl. approvals), and CI conclusions — into the session while working LOCALLY, where subscribe_pr_activity (cloud-only) can't reach. Arms a persistent Monitor poll loop so the model wakes only on real events, not on a timer. Use when the user says "watch the PR", "notify me on comments", or a local fleet/lifecycle needs a webhook substitute.
argument-hint: "<PR number, or empty = the current branch's PR>"
---

# Watch PR (local)

The cloud path wakes on GitHub activity via `subscribe_pr_activity` — a webhook relay that
**only exists in Claude's hosted/cloud environments**. A **local** Claude Code session has no
reachable callback endpoint, so that subscription silently delivers nothing. This skill is the
local substitute: a `Monitor` poll loop that streams new PR activity into the session as it
lands.

**Why `Monitor`, not `CronCreate`.** `Monitor` runs the poll loop in a **subprocess**; each
line it prints becomes an event that wakes the model. So the model wakes **only on real
activity**, not on every tick — cost tracks actual PR events, and the poll is deterministic
(fixed shell, not a model turn that re-decides each fire). `CronCreate` fires a *prompt* every
tick and costs a full turn whether or not anything changed. For watching a PR, `Monitor` wins.
(Full rationale + the cloud/local split: [`orchestration.md`](../../../docs/contributing/orchestration.md)
→ "Environment: cloud vs. local.")

## Preconditions

- **Local session.** If you're in a cloud session (the system prompt has a "remote execution
  environment" section, or `mcp__Claude_Code_Remote__*` tools resolve), use
  `subscribe_pr_activity` instead — it's strictly better there. Don't arm this in the cloud.
- **`gh` is authenticated and can reach the repo:** `gh auth status` and a probe like
  `gh pr view <n> --json number` succeed. If not, stop and tell the user — a silently failing
  poll loop looks identical to "no activity."

## Steps

1. **Resolve the PR.** Take an explicit number from the argument, else the current branch's PR:
   ```bash
   gh pr view --json number,headRefName,headRefOid,url
   ```
   Capture `OWNER`/`REPO` (from `gh repo view --json owner,name` or the remote), the PR number
   `N`, and the head SHA.

2. **Arm the Monitor** (persistent) with the poll loop below. It hits **three** endpoints, not
   the two a comment-only watcher would — PR comments, inline review-thread comments, **and
   reviews** (where an `APPROVED` / `CHANGES_REQUESTED` submission lives — the approval signal a
   comment-only loop misses), plus completed check-runs. Comments are `since`-windowed; reviews
   and checks are snapshot-diffed (no `since` param). `|| true` on every call so one failed
   request doesn't kill the watch.

   ```bash
   OWNER=<owner>; REPO=<repo>; N=<number>
   last=$(date -u +%Y-%m-%dT%H:%M:%SZ)
   # Noisy deploy bots you rarely want; drop or extend as the user prefers.
   NOISE='vercel\[bot\]|github-actions\[bot\]'
   # PRIME the review/check snapshots with current state so the first tick emits only
   # activity that lands AFTER arming (webhook semantics) — not the PR's whole history.
   # (Comments are already `since`-windowed to `last`, so they need no priming.)
   sha=$(gh pr view "$N" --json headRefOid -q .headRefOid 2>/dev/null)
   prev_rev=$(gh api "repos/$OWNER/$REPO/pulls/$N/reviews" \
     --jq '.[] | "\(.id)\t\(.user.login) \(.state)\(if (.body|length)>0 then ": "+(.body[0:200]) else "" end)"' 2>/dev/null | sort)
   prev_chk=$(gh api "repos/$OWNER/$REPO/commits/$sha/check-runs" \
     --jq '.check_runs[] | select(.status=="completed") | "\(.name): \(.conclusion)"' 2>/dev/null | sort)
   while true; do
     now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

     gh api "repos/$OWNER/$REPO/issues/$N/comments?since=$last" \
       --jq '.[] | "comment  \(.user.login): \(.body[0:280])"' 2>/dev/null \
       | grep -Ev "^comment  ($NOISE):" || true

     gh api "repos/$OWNER/$REPO/pulls/$N/comments?since=$last" \
       --jq '.[] | "inline   \(.user.login) [\(.path):\(.line // .original_line)]: \(.body[0:240])"' 2>/dev/null || true

     cur_rev=$(gh api "repos/$OWNER/$REPO/pulls/$N/reviews" \
       --jq '.[] | "\(.id)\t\(.user.login) \(.state)\(if (.body|length)>0 then ": "+(.body[0:200]) else "" end)"' 2>/dev/null | sort)
     [ -n "$cur_rev" ] && comm -13 <(printf '%s\n' "$prev_rev") <(printf '%s\n' "$cur_rev") \
       | sed 's/^[0-9]*\t/review   /' | grep -Ev "^review   ($NOISE) " || true
     [ -n "$cur_rev" ] && prev_rev=$cur_rev

     sha=$(gh pr view "$N" --json headRefOid -q .headRefOid 2>/dev/null)
     cur_chk=$(gh api "repos/$OWNER/$REPO/commits/$sha/check-runs" \
       --jq '.check_runs[] | select(.status=="completed") | "\(.name): \(.conclusion)"' 2>/dev/null | sort)
     [ -n "$cur_chk" ] && comm -13 <(printf '%s\n' "$prev_chk") <(printf '%s\n' "$cur_chk") \
       | sed 's/^/check    /' || true
     [ -n "$cur_chk" ] && prev_chk=$cur_chk

     last=$now
     sleep 60
   done
   ```

   Pass this as the `Monitor` `command` with `persistent: true` and a specific `description`
   (e.g. `"PR #<N> comments, reviews, CI"`). Each printed line becomes one notification.

3. **Tell the user what's covered — and what isn't.** Covered: new PR comments, new inline
   review comments, new/updated **reviews including approvals and change-requests**, and
   completed CI check conclusions. **Not** covered by this loop: the `draft→ready-for-review`
   promotion and merge/close (lower-frequency state transitions — re-check on demand, or add a
   low-frequency `CronCreate` backstop if the user wants them caught unattended). Note the
   60s interval and that the watch **ends when the session ends** (it's not durable — say so,
   don't imply parity with a cloud subscription).

## Notes

- **Bot noise.** The loop drops `vercel[bot]` / `github-actions[bot]` by default via `$NOISE`
  — extend or clear it per the user. **Don't** blanket-drop all bots if a local *orchestrator*
  is the consumer: a review-bot's `CHANGES_REQUESTED` is still actionable; only the human
  approval trips the sign-off gate, but the orchestrator still wants to see the rest.
- **Rate limits.** 60s is the floor for a remote API poll; go slower once the PR is quiet.
  A single `Monitor` per PR — don't arm several loops against the same PR.
- **Stopping.** `TaskStop` cancels the watch; do so once the PR merges/closes or the user asks.
