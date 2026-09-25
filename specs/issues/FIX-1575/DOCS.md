# FIX-1575 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

This issue's deliverable is documentation: in-repo architecture docs, package READMEs and code
comments. Below are drafts of the passages that change most. The other lines are one-word swaps
(*seat* → *assignee* or *the board's dispatcher*); [`ledger.mjs`](poc/vocabulary-inventory/ledger.mjs)
lists each one. No `apps/docs` page changes ([D3](DECISIONS.md#d3)). No changeset.

## UPDATE · `docs/architecture/authentication.md` · the pinned-instance paragraph after the route-kind table

An owner-pinned instance is registered with `register(flow, { pin })`, where the pin is
`{ orgId, userId? }`. The registering code supplies the pin; it never comes from the address.
Workforce pins every instance it hires this way, and its `registerHiredSeat` refuses one that
arrives with no pin. `create_session` and a session-less `execute_action` compare the caller to
the pin before the acknowledgement and answer a mismatch with `404 Unknown flow`, the same
sentence an address this process does not hold gets. An internal dispatch to a pinned instance
is refused at the dispatch seam, before a child session is written: a sending principal outside
the pin gets `flow-not-found`, the same refusal an unregistered address gets (see
[Dispatched Work](./dispatched-work.md)). Execution admission is the backstop. Every run,
including resume and retry, compares the bound session to the pin before any block and throws
`InstancePinMismatchError` on a mismatch. Its `reason` is `"owning-org"` or `"owning-user"`, the
half of the pin the caller missed; the organization is compared first. An instance registered
without a pin stays shared.

The comparison uses the principal the host resolved. On the framework default resolver that
principal names no organization, so opening a pinned instance answers `404 Unknown flow`, even
for its owner. Install a resolver that verifies the organization where the instance is
resolved: at the host when every flow authenticates, or on the instance itself (its
`authentication.resolvePrincipal`) in a mixed app whose other flows stay on the development
default. A host resolver that merely delegates to the default does not work, because the engine
recognises the development default by the resolver it runs (`isDefaultBodyUserIdPrincipalResolver`),
not by the principal it returns: a tokenless caller then gets 401 on actions (no verified
organization) and on the management routes and listings (enforcement switches on). With the
resolver on the instance, the flow catalog lists it to a caller that resolver admits and the pin
matches, because the catalog resolves each pinned instance through its own resolver, as the
doors do. The host listings (`list_sessions`, `active_requests`) show its sessions and in-flight
requests to the same caller, because they judge each of its rows through its resolver too. The
pin also picks where the instance stores a person's shared user data: one cell per (pin org,
person), never the person's cross-org cell (FIX-1538,
[State and Scopes](./state-and-scopes.md#the-owner-pinned-cell)).

## UPDATE · `docs/architecture/capabilities.md` · "A worker-colocated tool…" paragraph

**A tool registered per instance is not an exemption from this fence.** A higher layer may
register a block for one flow instance only (Workforce does, from an instance's own `blocks/`
folder). Registration makes the name resolvable; it does not grant its use. The instance still
names the block in its `tools:`, and what reaches the generator is one declared list. Core is
untouched by per-instance registration, and the fence stays exactly as literal as it reads above.

And the closing sentence of the control-tools paragraph: "Fencing one would leave a block
advertising a tool in its prompt that it cannot call."

## UPDATE · `packages/core/README.md` · `### dispatcher(config)`

A dispatcher is a handler that sends one dispatch to one declared entry instead of doing the
work itself. Its address (`type` and `action`) is fixed on the block; the session and the
payload are computed per call from the block's input. It comes in two shapes: an `internal`
dispatcher (`InternalDispatcherConfig`) sends this request's own authority to
`flow.internal.actions[action]`, and a `task` dispatcher (`TaskDispatcherConfig`) sits in a task
board's `workers` under an assignee and hands the rows claimed for that assignee to
`flow.task.actions[action]`. Omit `type` in both cases: ordinary dispatchers default to
`internal`, and a board's dispatcher is one whose `session` is `"per-task"`, `"per-worker"`, or
`{ key }`. Its stamped address is still `type: "task"`.

Table rows, changed cells only:

- `type`: "Omit it. Ordinary dispatchers send `internal`. A board's dispatcher stamps
  `type: "task"` from its session policy. An explicit `"task"` is still accepted."
- `session`, `task` half: "`"per-task"` (one child per row), `"per-worker"` (one child per
  assignee, shared by every row routed to it), or `{ key: (task, ctx) => string }`…"
- The dispatch-type table's `task` row: "A task board handing a claimed row to a child session,
  from a `dispatcher({ action, session })` in the board's `workers` (stamped `type: "task"`)".
- The envelope sentence keeps its field list, `{ boardId, seat, taskId, … }`, and adds after it:
  "`seat` is the assignee the board routed the row to."
- `flow-not-found`: "…or an [owner-pinned instance](https://flow-state.dev/docs/workforce/durable-hire)
  the sending session may not open (one pinned to another organization, or to another user)."

## UPDATE · `packages/scheduled/README.md` · the pinned-instance paragraph

On an owner-pinned instance (one registered with an owner `pin`: the organization, and user if
any, it is registered to), the dispatch route passes that pin to the resolver as
`ctx.ownerPin`. The helper then reads the row from that instance's storage for that
organization and person, derived with the engine's `resolveUserStorageKey`, and a row naming
another organization than the pin's resolves to `null`. A hand-written resolver that reads
user-scoped storage derives its key the same way:

## UPDATE · `docs/contributing/best-practices/resources.md` · BP-027, the FIX-1538 exception

Exception (FIX-1538): on an owner-pinned instance (one registered with an owner pin) a `false`
resource keys at the (org, person) cell `{userId}:~org:{orgId}`, so it is shared with that
person's other instances pinned to the same org and not with unpinned flows.

## UPDATE · `docs/architecture/dispatched-work.md` · opening paragraph, last sentence

A flow hands it off in one of two ways: a `dispatcher()` block in a running request, or a task
board with a `dispatcher({ action, session })` in its `workers`, which hands each row it claims
for that assignee to an entry declared under `flow.task.actions`.

## Voice notes for the implementer

These are internal docs, so the published-site rules apply loosely, but three matter here:
don't say *worker* for a seat or assignee; keep code names in code spans even when the prose
around them changes; don't add issue numbers the paragraph didn't already carry.
