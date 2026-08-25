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
# Validate our own arguments before touching the network, so a bad label reads as a usage
# error rather than an auth failure.
#
# Lowercase, and only [a-z0-9._-]. Two constraints meet here: header values are compared
# case-insensitively, so `A` and `a` are one identity and two sessions choosing them would
# each discard the other's mail as its own echo; and the watermark path is keyed on these,
# so sanitising instead of rejecting would alias `lane/a` and `lane_a` onto one file.
for arg in "$ME" "$MYSESSION"; do
  case $arg in
    *[!a-z0-9._-]*|'') echo "mailbox-poll: from/session must match [a-z0-9._-]+ (got '$arg')" >&2; exit 2 ;;
  esac
done
# Fail at arm time rather than polling forever against an expired token: a dead poll and a
# quiet mailbox are indistinguishable from the outside.
gh auth status >/dev/null 2>&1 || { echo "mailbox-poll: gh is not authenticated" >&2; exit 2; }

REPO=${MAILBOX_REPO:-fixpoint-labs/agent-mailbox}
INTERVAL=${MAILBOX_INTERVAL:-60}
STATE=${MAILBOX_STATE:-.orchestration/mailbox}
FILTER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/mailbox-filter.jq"
[ -r "$FILTER" ] || { echo "mailbox-poll: missing $FILTER" >&2; exit 2; }
mkdir -p "$STATE" 2>/dev/null || { echo "mailbox-poll: cannot create MAILBOX_STATE=$STATE" >&2; exit 2; }
[ -w "$STATE" ] || { echo "mailbox-poll: MAILBOX_STATE=$STATE is not writable" >&2; exit 2; }
declare -A fails            # consecutive fetch failures, per handle
FAIL_ALERT=${MAILBOX_FAIL_ALERT:-5}
OVERLAP=${MAILBOX_OVERLAP:-5}   # seconds of `since` back-off; see the url build below

# Watermarks are per (repo, identity, handle), never per handle alone: two sessions
# can share one checkout and one handle under different from/session pairs, and a
# shared watermark would let the first poller advance past a message addressed to
# the second — silently, since that message never passes the first one's filter.
ns="$(printf '%s' "$REPO" | tr '/' '_')-$ME-$MYSESSION"

while true; do
  for pr in ${PRS//,/ }; do
    wm="$STATE/$ns-pr-$pr.id"
    # An older watermark holds only an id; the missing timestamp just means the
    # first fetch after upgrading is unwindowed.
    since_id=0; since_ts=
    [ -f "$wm" ] && read -r since_id since_ts < "$wm"

    # Window the fetch by server-side updated_at so a long-lived handle costs one page,
    # not its whole history. The id watermark is what decides what is NEW; `since` only
    # bounds what we ask for. Back it off by OVERLAP seconds: GitHub documents `since`
    # as strictly *after*, and its timestamps are second-precision, so a comment landing
    # in the same second as the watermark would otherwise be excluded from every later
    # request — silently and forever. The overlap re-fetches a little; the id filter
    # drops it. jq does the arithmetic so this needs no GNU `date`.
    url="repos/$REPO/issues/$pr/comments?per_page=100"
    if [ -n "$since_ts" ]; then
      from_ts=$(jq -rn --arg t "$since_ts" --argjson o "$OVERLAP" \
        '($t | fromdateiso8601) - $o | todateiso8601' 2>/dev/null) || from_ts=
      [ -n "$from_ts" ] && url="$url&since=$from_ts"
    fi

    if ! json=$(gh api --paginate "$url" 2>/dev/null | jq -s 'add // []' 2>/dev/null) \
       || [ -z "$json" ]; then
      fails[$pr]=$(( ${fails[$pr]:-0} + 1 ))
      # Say it once, on the wake channel. Staying silent here reports a broken poll
      # as an idle mailbox, which is the one thing an operator cannot tell apart.
      [ "${fails[$pr]}" = "$FAIL_ALERT" ] && \
        printf 'mail #%s POLL FAILING — %s consecutive fetch errors, mail is NOT being checked\n' \
          "$pr" "$FAIL_ALERT"
      continue
    fi
    fails[$pr]=0

    read -r max_id max_ts < <(printf '%s' "$json" \
      | jq -r '"\(map(.id) | max // 0) \(map(.updated_at) | max // "")"') || continue

    # First sight of a handle: record where we came in rather than replaying its
    # history. Priming, not amnesia — the backlog at arm time is the caller's to read
    # directly, exactly as with watch-pr. This MUST run before the empty-window check:
    # a freshly registered handle has no comments, and skipping the prime would leave
    # no watermark, so its first real message would be primed away instead of emitted.
    if [ ! -f "$wm" ]; then printf '%s %s' "$max_id" "$max_ts" > "$wm"; continue; fi

    # Nothing came back inside the window: leave the watermark where it is.
    [ "$max_id" = "0" ] && continue
    # Never regress the id. Editing one old comment can make it the only thing the
    # window returns; writing its lower id back would re-emit every message above it.
    [ "$max_id" -lt "$since_id" ] && max_id=$since_id

    # Capture before printing. A jq failure here must NOT reach the watermark write:
    # advancing over a batch we never emitted would mark unseen mail as delivered and
    # skip it on every later tick — a silent, permanent drop.
    # Each record carries its own `#<pr>/<id>` prefix. A single printf prefixing the
    # whole block would label only the first line, and every line is a separate wake —
    # so later ones would arrive unroutable when this watches more than one handle.
    # The id is what makes a truncated body retrievable.
    out=$(printf '%s' "$json" \
      | jq --arg me "$ME" --arg mysession "$MYSESSION" --arg since "$since_id" -f "$FILTER" \
      | jq -r --arg pr "$pr" '.[] | "mail #\($pr)/\(.id) \(.from)/\(.session // "-")\(if .to then " -> " + .to else " (all)" end) [\(.kind // "msg")]: \(.text)"') || continue
    [ -n "$out" ] && printf '%s\n' "$out"

    # Advance past everything fetched, not only what we emitted: our own posts never
    # pass the filter, so a watermark that tracked emissions would never move past them.
    printf '%s %s' "$max_id" "$max_ts" > "$wm"
  done
  [ "${MAILBOX_ONCE:-}" = "1" ] && exit 0
  sleep "$INTERVAL"
done
