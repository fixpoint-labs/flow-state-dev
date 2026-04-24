#!/usr/bin/env python3
"""
date-window.py — compute an ISO date window for a news-recency target.

The `check-news` skill uses freshness thresholds like "past 7 days" or
"past 30 days" that depend on today's date. This script returns those
windows as ISO-8601 dates so the agent can drop them into search queries
or cite them in the response, without having to reason about dates from
its training cutoff.

Usage:
  python3 date-window.py <kind>

  where <kind> is one of:
    breaking         -> last 24 hours (1 day)
    recent           -> last 7 days
    week             -> last 7 days
    current-state    -> last 90 days
    quarter          -> last 90 days
    month            -> last 30 days
    ai               -> last 14 days (tighter window for AI news)
    business         -> last 14 days (filings / earnings window)
    year             -> last 365 days

Output is JSON on stdout, one object:
  {"kind": "...", "days": N, "since": "YYYY-MM-DD", "until": "YYYY-MM-DD"}

Exit codes: 0 success, 2 unknown kind.
"""

import json
import sys
from datetime import date, timedelta

WINDOWS = {
    "breaking": 1,
    "recent": 7,
    "week": 7,
    "current-state": 90,
    "quarter": 90,
    "month": 30,
    "ai": 14,
    "business": 14,
    "year": 365,
}


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(f"usage: {argv[0]} <kind>", file=sys.stderr)
        print(f"kinds: {', '.join(sorted(WINDOWS))}", file=sys.stderr)
        return 2

    kind = argv[1].strip().lower()
    if kind not in WINDOWS:
        print(f"unknown kind: {kind!r}", file=sys.stderr)
        print(f"kinds: {', '.join(sorted(WINDOWS))}", file=sys.stderr)
        return 2

    days = WINDOWS[kind]
    today = date.today()
    since = today - timedelta(days=days)

    print(
        json.dumps(
            {
                "kind": kind,
                "days": days,
                "since": since.isoformat(),
                "until": today.isoformat(),
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
