# Session telemetry: a control-plane flow exposed as MCP

Design note. Not implemented. Companion to `redesign-choreography.md` — that
note reshapes *how the orchestrator reacts to the board*; this one closes a gap
neither the board nor the choreography model addresses: **we can trigger cloud
Claude sessions but can't see which ones exist or what they're doing.**

Exploratory. This lives in `labs/` and stays there unless it proves solid and
self-contained enough to graduate. See "Isolation" at the end for what would
have to leave the lab to productize, and what wouldn't.

## The gap

The cloud dispatch is one-way. `claude --remote` starts a session and returns a
best-effort handle (`ClaudeRemoteHandle.sessionId` is parsed from stdout and is
often `null`; the CLI exposes no list/inspect API). So the current orchestrator
is a "conductor that never watches the agent" *by necessity* — it infers agent
progress from side effects (the board moved → the spec must be done).

The board is the right source of truth for **work-state** ("what stage is this
issue in"). But it structurally can't answer two other questions:

- **Enumeration** — which agent sessions are alive right now?
- **Liveness / intra-stage activity** — is the agent working, wedged, or dead;
  and what is it mid-doing ("opening the PR", "addressing review feedback")? An
  issue sitting in `In Spec Dev` says nothing about whether its agent is running
  or crashed. That blind spot is exactly what forces the blunt 24h watchdog and
  the "terminal states invisible while parked" gap called out in the PR review.

Fix it by flipping one channel from pull to push: **each session self-reports.**

## The idea

Each Claude session knows its own `session_id` (handed to it directly
in-context) and, being the entity actually dispatched to do the work, knows
which issue it's working. So the agent registers itself and reports semantic
milestones as it hits them, via MCP tool calls. Those reports land in a small
hosted service that maintains a session registry and owns the Linear board
writes.

That service is itself an **FSD flow exposed as an MCP server** — which the
framework already supports, so this is mostly assembly.

## What the framework already provides

`@flow-state-dev/mcp` (`createMcpTransportAdapter`) exposes any flow with
`mcp: { enabled: true }` as its own MCP server over **Streamable HTTP** at
`POST /api/flows/:kind/mcp`. Verified against the code:

- **Actions become tools automatically.** Every action with a `description` is
  surfaced as an MCP tool (`actionToMcpTool`); `defineFlow` *enforces* the
  description when `mcp.enabled` is true. Opt an action out with
  `action.mcp: { enabled: false }`.
- **Remote HTTP, not stdio.** Right shape for cloud sessions to reach a shared
  service — not a local process that dies with the session.
- **Bearer auth is first-class.** Each request runs `host.resolvePrincipal(...)`;
  a `PrincipalResolutionError` → `401 WWW-Authenticate: Bearer`. This is where a
  scoped token is validated.
- **Stateless v1.** Every `tools/call` spins a fresh flow session
  (`sessionId: undefined`, no `Mcp-Session-Id`). Consequence: registry state
  can't live in flow-session state — it must be rows in a store the actions
  read/write. That's simpler anyway: no durable suspend/resume in this flow.
- **Mounts alongside HTTP.** `createFlowApiRouter({ adapters: [createMcpTransportAdapter()] })`
  serves the *same actions* over both the MCP route (`/:kind/mcp`) and the plain
  HTTP action route (`POST /api/flows/:kind/actions/:actionName`, router.ts:98).
  That dual-transport detail is load-bearing below.

## Architecture

```
cloud Claude session  (dispatched for a specific issue; the agent is TOLD its
                        own session_id in-context and knows the issue from its
                        own task — no dispatcher-side injection required)
   │
   │  (SessionStart hook: not wired in v1. It can only prove "a session
   │   exists" — no task/issue info in its payload, no MCP tool access. Left
   │   as a future, non-load-bearing backstop — see "Registration is
   │   agent-driven.")
   │
   └─ the agent  ──MCP──▶  tools/call registerSession   (first call: sessionId +
      │                     issue → binds sessionId→issue, returns a capability
      │                     token scoped to this registration)
      └─ ──MCP──▶  tools/call reportStatus   (sessionId + capabilityToken +
                     status; semantic milestones; bumps lastSeen as a side
                     effect — no separate heartbeat action needed in v1)
                                          │
                                          ▼
                        session-control flow  (mcp.enabled: true, on Vercel)
                          actions: registerSession · reportStatus
                                          │
                        ┌─────────────────┴─────────────────┐
                        ▼                                     ▼
                 session registry store              Linear board writes
                 (hosted DB: sessionId, issue,        (the flow owns ALL
                  capabilityToken, status,             transitions, validated)
                  registeredAt, lastSeen)
                                          ▲
                        liveness sweep (reads the REGISTRY, not Linear):
                        lastSeen older than N min → escalate / mark stalled
```

The agent never writes Linear directly. It reports *intent* ("I opened PR #606");
the flow decides the transition. One validated, testable write path instead of
Linear writes smeared across every skill — this is what "the flow manages the
board" buys.

## The session-control flow

Two described actions (each auto-exposed as an MCP tool and reachable over HTTP):

- `registerSession({ sessionId, issue, stage })` — fired by the **agent**, as
  its first MCP call. First sight of a `sessionId` binds it to `issue`; a later
  call claiming a *different* `issue` for an already-bound `sessionId` is
  rejected. This models the real lifecycle correctly: multiple sessions can
  work an issue over time (a spec session, then a separate implement session),
  but a given session, once bound, stays bound to that one issue. Returns an
  opaque capability token scoped to this registration (see Security).
- `reportStatus({ sessionId, capabilityToken, status, prNumber? })` — requires
  the capability token issued at registration; a request with the wrong or
  missing token for that `sessionId` is rejected. Updates the row, bumps
  `lastSeen`, and maps `status` to a board transition. Small vocabulary:
  `working · awaiting-review · addressing-feedback · done · errored`. Fired by
  the agent at milestones (skills carry the report steps).

No separate `heartbeat` action in v1 — `reportStatus` already bumps `lastSeen`
on every call, which is enough to start. A dedicated timer-driven heartbeat is
deferred (see Open questions): no verified hook mechanism exists to drive one,
and inventing an unverified one isn't worth it until the agent's natural
status cadence proves too coarse for the liveness sweep.

Registry row (one `sessions` table, hosted DB):

```
sessionId · issue · stage · status · prNumber? · capabilityToken · registeredAt · lastSeen
```

## Registration is agent-driven, not hook-driven

Checked against the actual hook payload: `session-start-hook`'s documented
`SessionStart` stdin is `{session_id, source, transcript_path, permission_mode,
hook_event_name, cwd}`, plus three fixed environment variables
(`$CLAUDE_PROJECT_DIR`, `$CLAUDE_ENV_FILE`, `$CLAUDE_CODE_REMOTE`) — none of it
task- or issue-related. The hook can prove "a session with this `session_id`
exists," nothing more. It structurally cannot register a session against an
issue.

So the agent registers itself, via the MCP tool, as its first action — it
already has both values a registration needs (its own `session_id`, handed to
it directly in-context the same way this environment hands every session its
ID for commit trailers, and the `issue`, its assigned task). This is simpler
than a hook/agent split, not more complex: one caller, one path, no
hook-to-agent handoff to design.

The `SessionStart` hook's role shrinks to optional and non-load-bearing: a
best-effort "session exists" ping, useful only as a backstop for a session that
errors out before ever calling a tool. The design works without it.

## Principles to lock

1. **Board = ground truth for work-state; registry = agent liveness + telemetry.**
   This keeps us honest against the choreography note's core complaint: *don't
   keep a second ledger of work-state that can only drift.* The registry is not
   that — it tracks a **different axis** (is the agent alive, what's it mid-doing)
   that the board can't represent. No overlap, no drift race on work-state.
2. **Self-reporting is best-effort.** A crashed or forgetful agent goes silent.
   So the registry is never the *sole* source of truth: a PR exists or it
   doesn't; the board is where it is. Push telemetry layers on top of the
   authoritative external signals (board, GitHub) — it never replaces them. The
   liveness sweep exists precisely because reports can stop coming.
3. **Board-write authority centralizes in the flow.** Agents report intent; the
   flow decides transitions. Removes direct Linear writes from skills.
4. **Liveness is the one remaining poll — over the registry, not Linear.** A
   periodic sweep for stale `last_seen` is what finally closes "agent died /
   terminal state invisible." Cheap, and it reads our own table.

## Security

These sessions ingest untrusted external content by design — PR comments, issue
bodies, CI logs — a live prompt-injection surface. That rules out handing the
agent production DB credentials: the blast radius of a confused-or-injected
agent would be the entire database. The MCP/HTTP flow is the guarded surface
instead — validation, rate-limiting, a versioned contract, rotation.

**Two layers, not one.** A single shared admission token, configured once at
the environment level (`${FSDEV_ORCH_TOKEN}` env-interpolated in `.mcp.json`,
never committed — environments already support configured env vars, so this
needs no per-dispatch injection), proves "this caller is a legitimate FSD
session." That's all it proves. It is not enough on its own, because
`sessionId` and `issue` are both public in this project: session IDs land in
commit trailers and PR bodies by our own convention, and not only after a
session ends — an early commit publishes a still-active session's ID to
`git log`, visible to any other session running concurrently. Issue numbers are
more exposed still (Linear ticket, PR title). So a shared token plus a
client-supplied `{sessionId, issue}` pair is forgeable: anything that has read
one session's commit trailer has every value needed to impersonate it in a
`reportStatus` call. The `registerSession` first-sight/reject-on-mismatch rule
doesn't catch this — it only stops a session from reassigning *itself* to a
different issue, not another caller impersonating an already-bound session.

**Fix: a capability token issued at registration.** `registerSession`'s first
call for a `sessionId` returns an opaque token scoped to that registration;
every subsequent `reportStatus` call for that `sessionId` must present it, and
a mismatched or missing token is rejected. No extra plumbing: the agent is the
one that calls `registerSession` via MCP, so the token is already sitting in
its own context from the tool result. Worst case on a compromised session: it
can lie about *its own* issue's status. It cannot forge calls for another
session, because it never sees that session's token — only its published,
non-secret ID.

**Residual, accepted risk.** A race where an attacker registers a fake session
under a real (but not-yet-published) `session_id`, before the real session's
first call lands, requires guessing a fresh, high-entropy ID that hasn't leaked
anywhere yet — a materially harder problem than reading one out of `git log`.
Reasonable to leave unaddressed for a lab exploration rather than engineer
against now.

## Relationship to the choreography redesign

Complementary, not competing — different axis (work-state vs agent-state). But it
compounds the redesign: if sessions push `reportStatus(done)` and the flow moves
the board, the durable park/gate/resume **driver** loses most of its job. Push
replaces poll for completion; the registry liveness sweep replaces the watchdog.
The orchestrator shrinks to **dispatch + this control-plane flow + a thin
sweep** — which is more evidence for the redesign's "drop the durable sequencer"
conclusion. The `Keep` list in that note (stage machine, `LinearStatusClient`,
`GitHubSignalClient`, completion predicate, PTY dispatch) is unchanged and still
reused here.

## Open questions

- **Does the cloud runner load a repo-root `.mcp.json`?** Hooks are confirmed
  (verified against `session-start-hook`'s own documentation — see
  "Registration is agent-driven"). MCP server pickup from a committed
  `.mcp.json` is the one remaining transport-level unknown; needs a quick
  empirical check before wiring a real hook or skill against it.
- **Registry store.** Stateless serverless rules out `store-sqlite`. Needs a
  hosted DB (Vercel Postgres or similar). One small table.
- **Status ↔ board mapping ownership.** Keep the `status → Linear state` map a
  pure function (same discipline as the choreography note's `state → action`
  map), tested in isolation and consulted by `reportStatus`.
- **Dedicated heartbeat.** Deferred — `reportStatus` already bumps `lastSeen`
  on every call. Revisit only if the agent's natural status cadence proves too
  coarse for the liveness sweep (e.g. a long silent stretch mid-stage with no
  status change to report).

## Sequencing

1. **Prototype the flow in isolation.** A `session-control` flow with the two
   actions + a fake board client, proving actions-as-MCP-tools and the
   status→transition path under unit tests. No deployment, no real Claude. This
   is the cheap kernel and it stays entirely in the lab.
2. **Confirm the one remaining unknown** — does the cloud runner load a
   repo-root `.mcp.json`? — before building the hosted piece.
3. **Wire one hook + one skill step** against a locally-run flow to prove the
   round trip end to end.
4. Only then consider a Vercel deployment + real registry DB.

## Isolation

What stays in the lab: the `session-control` flow, its actions, the status→state
map, tests. What would have to leave the lab to productize (and is therefore
out of scope for a lab-only merge): a hosted Vercel deployment, a shared
registry DB, and any change to the published `create-spec` / `implement-issue`
skills or a repo-root `.mcp.json`. As long as the exploration is confined to the
flow + tests here, it merges as self-contained lab code; the moment it needs a
shared deployment or edits shared skills/config, that is a separate, deliberate
step.
