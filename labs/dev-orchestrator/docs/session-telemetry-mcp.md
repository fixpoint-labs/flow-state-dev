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

Each Claude session knows its own `session_id`. A `SessionStart` hook can
register it the instant the session boots, and the agent can report semantic
milestones as it hits them. Those reports land in a small hosted service that
maintains a session registry and owns the Linear board writes.

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
dispatcher (has authority; knows {issue, stage} at trigger time)
   │  mints a scoped token, injects it + {issue} into the cloud session env
   ▼
cloud Claude session
   ├─ SessionStart hook  ──HTTP──▶  POST /api/flows/session-control/actions/registerSession
   │     (shell command: curl; hooks CANNOT call MCP tools)
   ├─ periodic heartbeat ──HTTP──▶  .../actions/heartbeat
   └─ the agent          ──MCP───▶  tools/call reportStatus   (semantic milestones)
                                          │
                                          ▼
                        session-control flow  (mcp.enabled: true, on Vercel)
                          actions: registerSession · reportStatus · heartbeat
                                          │
                        ┌─────────────────┴─────────────────┐
                        ▼                                     ▼
                 session registry store              Linear board writes
                 (hosted DB: alive, last_seen,       (the flow owns ALL
                  status, issue, prNumber)            transitions, validated)
                                          ▲
                        liveness sweep (reads the REGISTRY, not Linear):
                        last_seen older than N min → escalate / mark stalled
```

The agent never writes Linear directly. It reports *intent* ("I opened PR #606");
the flow decides the transition. One validated, testable write path instead of
Linear writes smeared across every skill — this is what "the flow manages the
board" buys.

## The session-control flow

Three described actions (each auto-exposed as an MCP tool and reachable over HTTP):

- `registerSession({ sessionId, issue, stage })` — upsert a registry row, mark
  alive. Fired by the `SessionStart` hook.
- `reportStatus({ sessionId, status, prNumber? })` — update the row **and** map
  the status to a board transition. Small vocabulary:
  `working · awaiting-review · addressing-feedback · done · errored`. Fired by
  the agent at milestones (skills carry the report steps).
- `heartbeat({ sessionId })` — bump `last_seen`. Fired by a hook on a timer (and
  implicitly by every other call).

Registry row (one `sessions` table, hosted DB):

```
sessionId  ·  issue  ·  stage  ·  status  ·  prNumber?  ·  registeredAt  ·  lastSeen
```

## Two entry paths, one flow

- **Hooks → HTTP.** `SessionStart` and the heartbeat timer are shell commands.
  They `curl` the HTTP action route. Hooks *cannot* call MCP tools — MCP tools
  are model-invoked, not shell-invoked. Hooks own registration + liveness (the
  reliable, lifecycle-driven signals).
- **Agent → MCP.** Semantic transitions ("opened the PR", "addressing feedback")
  are not lifecycle events — no hook can observe them. They come from the agent
  deliberately calling `reportStatus`, driven by explicit steps baked into the
  `create-spec` / `implement-issue` skills. Reporting becomes part of the skill
  protocol, not an inference.

Same flow, same actions, two transports. The split falls out of the framework
mounting both adapters together.

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

Tighten it with a **per-issue scoped token**: the dispatcher (already
authoritative) mints a token whose principal is `{ issue, stage }` and injects
it into the cloud session env; `resolvePrincipal` validates it and the actions
authorize writes only to that issue's rows and board. Worst case on leak: the
agent lies about *its own* issue's status. It cannot touch other sessions or the
rest of the DB.

The token must be env-interpolated in `.mcp.json` (`${FSDEV_ORCH_TOKEN}`), never
committed. Open question below: whether the web environment can inject a
*per-session* env var, or only a shared one.

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

- **Per-session token injection (resolve first — security-critical).** Can the
  dispatch / web environment inject a per-issue-scoped env var into the cloud
  session so `.mcp.json` resolves a scoped token? If only a shared token is
  possible, the fallback is an issue-scoped token set via environment config at
  dispatch. This gates the blast-radius guarantee above.
- **Correlation.** Don't lean on `ClaudeRemoteHandle.sessionId` (best-effort,
  often null). Have the session self-report its own `session_id` at registration
  under the dispatcher-stamped `issue` key; query "sessions for FIX-123."
- **Does the cloud runner honor repo `.mcp.json` and `settings.json` hooks?**
  High confidence on hooks (there is a `session-start-hook` skill for exactly the
  web environment); `.mcp.json` pickup needs a quick confirm.
- **Registry store.** Stateless serverless rules out `store-sqlite`. Needs a
  hosted DB (Vercel Postgres or similar). One small table.
- **Status ↔ board mapping ownership.** Keep the `status → Linear state` map a
  pure function (same discipline as the choreography note's `state → action`
  map), tested in isolation and consulted by `reportStatus`.

## Sequencing

1. **Prototype the flow in isolation.** A `session-control` flow with the three
   actions + a fake board client, proving actions-as-MCP-tools and the
   status→transition path under unit tests. No deployment, no real Claude. This
   is the cheap kernel and it stays entirely in the lab.
2. **Confirm the two unknowns** (per-session env injection; cloud honors
   `.mcp.json`) before building the hosted piece — they can invalidate the token
   model.
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
