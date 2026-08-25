#!/usr/bin/env bash
# Mailbox poll — LOCAL sessions only (needs an authenticated `gh`).
#
# Prints one line per new mailbox message addressed to this session, and nothing at
# all otherwise. Run it under `Monitor`: each printed line becomes a wake, so a tick
# with no mail for us costs no model tokens. Our own posts echoing back, bot noise,
# and messages aimed at another subscriber are dropped in the subprocess and never
# reach the model.
#
#   mailbox-poll.sh <from> <session> <pr>[,<pr>...]
#   mailbox-poll.sh fsd-em a 2,7
#
# Env: MAILBOX_REPO (default fixpoint-labs/agent-mailbox)
#      MAILBOX_INTERVAL  seconds between ticks (default 60 — the floor for a remote API)
#      MAILBOX_STATE     watermark dir (default .orchestration/mailbox)
#      MAILBOX_ONCE=1    one pass then exit, for testing

set -uo pipefail

ME=${1:-}; MYSESSION=${2:-}; PRS=${3:-}
if [ -z "$ME" ] || [ -z "$MYSESSION" ] || [ -z "$PRS" ]; then
  echo "usage: mailbox-poll.sh <from> <session> <pr>[,<pr>...]" >&2; exit 2
fi
command -v gh  >/dev/null || { echo "mailbox-poll: needs gh (local sessions only)" >&2; exit 2; }
command -v jq  >/dev/null || { echo "mailbox-poll: needs jq" >&2; exit 2; }

REPO=${MAILBOX_REPO:-fixpoint-labs/agent-mailbox}
INTERVAL=${MAILBOX_INTERVAL:-60}
STATE=${MAILBOX_STATE:-.orchestration/mailbox}
FILTER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/mailbox-filter.jq"
[ -r "$FILTER" ] || { echo "mailbox-poll: missing $FILTER" >&2; exit 2; }
mkdir -p "$STATE"

while true; do
  for pr in ${PRS//,/ }; do
    # --paginate emits a sequence of arrays; -s add folds them into one.
    json=$(gh api --paginate "repos/$REPO/issues/$pr/comments" 2>/dev/null | jq -s 'add // []' 2>/dev/null) || continue
    [ -z "$json" ] && continue
    max=$(printf '%s' "$json" | jq 'map(.id) | max // 0') || continue

    wm="$STATE/pr-$pr.id"
    # First sight of a handle: record where we came in rather than replaying its
    # history. Priming, not amnesia — the backlog at arm time is the caller's to read
    # directly, exactly as with watch-pr.
    if [ ! -f "$wm" ]; then printf '%s' "$max" > "$wm"; continue; fi

    printf '%s' "$json" \
      | jq --arg me "$ME" --arg mysession "$MYSESSION" --arg since "$(cat "$wm")" -f "$FILTER" \
      | jq -r --arg pr "$pr" '.[] | "mail #\($pr) \(.from)/\(.session // "-")\(if .to then " -> " + .to else " (all)" end) [\(.kind // "msg")]: \(.text)"'

    # Advance past everything fetched, not only what we emitted: our own posts never
    # pass the filter, so a watermark that tracked emissions would never move past them.
    printf '%s' "$max" > "$wm"
  done
  [ "${MAILBOX_ONCE:-}" = "1" ] && exit 0
  sleep "$INTERVAL"
done
