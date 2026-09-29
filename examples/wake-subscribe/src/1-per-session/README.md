# 1 — Per-session subscribe (Cloud-like)

Each session names the pull request or issue it cares about. The transport
would deliver only to that session. That table is a **sketch**. Today's
adapter does not consult it.

```
1-per-session/
  host.ts                         ← GitHub provider registered once
  workers/reviewer/WORKER.md      ← subscribe + autoSubscribe (seat file)
  workers/reviewer/subscribe.ts   ← compile → subscription rows, not webhooks.on
  workers/reviewer/kind.ts        ← no webhooks. Hop to triage via dispatcher
  workers/triage/kind.ts
  leftover/CHANNEL.md             ← Layer 2 leftover
```

How an end user would see it: the seat file says *this session, this PR*.
`hireWorkforce` does not apply `subscribe:` — extra frontmatter is seat
config, and a closed `workerConfigSchema()` refuses the key.

Opening a review is when **auto-subscribe** would record `acme/app#pr88`.
A later `pull_request` delivery for #88 matches that row. #89 does not.

That is not today's `sessionId: (event) => repo#number`. That function
runs at delivery and find-or-creates a session from the payload. Style 1
requires the session to have asked first.

`dispatcher({ flowKind, action, session: { key } })` hops to triage after
review starts. `{ id }` on BullMQ is FIX-1634 — pointer only.
