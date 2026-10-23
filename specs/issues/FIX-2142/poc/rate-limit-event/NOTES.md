# What a `rate_limit_event` carries, read from the pinned CLI

Throwaway evidence, not production code. FIX-2142 rests on what Claude Code
sends in a `rate_limit_event`, and the Agent SDK's type (`SDKRateLimitInfo`)
says only that every field but `status` is optional. The CLI the pinned SDK
ships (`@anthropic-ai/claude-agent-sdk` 0.3.234) shows when each one is there.

```bash
node specs/issues/FIX-2142/poc/rate-limit-event/inspect.mjs   # 8/8 found, exit 0
node specs/issues/FIX-2142/poc/rate-limit-event/inspect.mjs /bin/ls   # 0/8, exit 1 (the control)
```

## What it showed

| Claim | What the CLI does |
|---|---|
| Sparse | It builds the limits from each API response's `anthropic-ratelimit-unified-*` headers and sends an event only when they differ from the last ones. The first response of a run differs from the empty start, so a run on a subscription sends at least one |
| Plain `allowed` has no percent | Below a warning, the event is `{ status: "allowed", resetsAt, rateLimitType }`: the window the server names as the binding one (`representative-claim`) and its reset. No `utilization` |
| A percent comes with a warning | `utilization` is set only on `allowed_warning`: when the server sends a `*-surpassed-threshold` header, or when the CLI's own early-burn check fires (5-hour: 90 % used with 72 % of the window left to run; 7-day: 25 / 50 / 75 % used by 15 / 35 / 60 % of the window) |
| Limit reached | `status: "rejected"` with `resetsAt` and the window. No `utilization` |
| Units | `utilization` is a fraction, 0 to 1 (the thresholds above are 0.9, 0.75 …, and the status line multiplies the same header by 100 for `used_percentage`). `resetsAt` is epoch **seconds** (compared as `resetsAt * 1000` with `Date.now()`) |
| No subscription | On an API key the limits reset to a bare `allowed` with no window, so an event, if any, names no `rateLimitType` |

## What it did not show

- A live event from a real subscription. That is the goal check's leg owed by a
  person (Jake's sign-in), as FIX-2141's leg f is.
- Whether a headless SDK run runs a configured status line, which gets both
  windows' percent on every response. One try with an invalid key did not run it
  (`statusLine` command never wrote its file). Not settled; the status line is a
  terminal feature, and FIX-2142 does not depend on it.
