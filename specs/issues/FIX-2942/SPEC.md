# FIX-2942 · A block reads and writes another of its owner's sessions by naming it

**Spec** · [Decisions](DECISIONS.md)

| Someone who… | Today | After |
|---|---|---|
| **writes a worker that settles its task on the conversation that filed it** | Can't reach that conversation's data. The board was moved to user scope and split per conversation so the worker could find it | Names the conversation: `ctx.resources.at({ session }).<name>` reads and writes its copy |
| **hands another of their sessions an id that isn't theirs** | n/a: no block can name a session | Gets the same answer as for an id nobody holds, on every verb. Another user, the same user in another org or tenant, a no-org session and a session an own-resolver flow refuses all read as missing |
| **owns the session that was written to** | n/a | Hears the write as it hears its own: the change bus, and for a task's ending the task notice. Fifty writes in a burst start at most one turn |
| **runs a worker woken by a webhook** (a PR comment, a CI event) | n/a | Reaches no other session, directly or through the owner runs the delivery fires. Two operations bound to a server-held session still run under their own checks: a board's settle on the claimed task's session, and a subscription delivery |
| **lists or claims from a copy** | Acts on the session's own copy, or its lineage root | Acts on one copy: its own, or the one it named. Nothing sweeps every session |

Each feature that needed another session's data built its own way around this. The epic
([FIX-2941](../../epics/FIX-2941/SPEC.md)) replaces those ways with one reach, and this issue is
that reach.

## The goal, and how we'll know it's met

**Within one owner, a block reads and writes another session's copy of a resource by naming the
session, and a session outside that owner is answered as missing, the way the HTTP routes answer
it.**

| Is it the right goal? | |
|---|---|
| **The real need** | Rules 5, 7 and 8 of [the concept doc](../../../docs/internal/design/scopes-and-sessions.md#the-rules), under the epic's ER-1 to ER-3: one reach, admitted by the routes' own functions, with the owning session told |
| **Smaller, and rejected** | "Reach for the owner's sessions, checked on user, org and tenant." It reaches sessions a browser can't: one an own-resolver flow refuses, or one with no org |
| **Bigger, and not this issue's** | Seeing across sessions in one read (FIX-2945). Moving the board onto this reach (FIX-2946) |
| **Not done if** | A refusal test is missing · a refused session answers differently from an unknown one on any verb · a write lands with no notice to the owning session · a turn is started per write · a webhook-started turn, or a run it fires, reaches another session other than through D1's two exceptions |

```mermaid
flowchart LR
  B["a real flow's block · session A"] --> R["at session B · read, write, list"]
  R -->|"same owner"| P["PASS · B's copy read and written · B hears it once"]
  R -->|"seven refusal cases"| M["PASS · each as missing, same as an unknown id"]
  C["control · owner check on user only"] -.-> R
  M -.->|"under the control"| F["must FAIL · other-org case reads B"]
```

The check reads what the block got back and what session B heard, not the admission function's
return value.

| How we verify | |
|---|---|
| **Goal check** | `goals/sessions-reach/name-a-session/` · no model · run by the implementer at completion, in-process and behind a runner · verdict in the implementation PR |
| **Signal** | Same owner: a read, a write and a list on B's copy return B's data; B's change bus carries one notice per write; twenty writes in one burst start one turn of B's entry. Each refusal case (another user, another org, another tenant, a no-org session, an own-resolver refusal, two schedules on the gateway principal, a custom-resolver target from another flow) answers exactly as an unknown id does, on read, write and list. An owner run fired by a service webhook, whose input names another session: read, list, `acrossSessions()`, a plain write and a named action other than settle are each refused alike; the settle on its claimed task's session passes |
| **Input** | Two sessions of one owner on two flows that both declare a `notes` collection. Any other per-session definition must pass too |
| **Anti-game** | Assert on what the block reads back and on B's bus, never on the admission function. Compare each refusal byte for byte with an unknown id's answer |
| **Control that must fail** | `GOAL_CONTROL=owner-user-only` must FAIL *other-org reads as missing*. `GOAL_CONTROL=turn-per-write` must FAIL *one turn per burst*. `GOAL_CONTROL=webhook-source-only` must FAIL *the owner run is refused*. Today's `main` fails the same-owner row |

## What changes

```mermaid
flowchart LR
  subgraph today["Today"]
    T1["block in A"] --> T2["A's own copy"]
    T1 -.->|"sharedToLineage"| T3["the lineage root"]
  end
  subgraph after["After"]
    A1["block in A"] --> A2["A's own copy"]
    A1 -->|"at session B"| G["the routes' admission"]
    G -->|"admitted"| A3["B's copy · B hears it"]
    G -->|"refused"| A4["as missing"]
  end
```

Today a block reaches its own copy or its lineage root. After, it can name any session, and the
routes' admission decides what it finds. The lineage branch goes in FIX-2947.

```diff
  ctx.resources.notes                                // this session's copy
+ ctx.resources.at({ session: launchChatId }).notes  // the launch chat's copy, read and write
```

**Docs:** this issue carries the epic's shared story. Its changeset says "a scope is how many
copies exist; the owner decides who may look; name a session to reach its copy", and its PR
updates `docs/architecture/state-and-scopes.md` with a *Another session's copy* section that also
says when to use `ctx.sessions` instead. The resource guides follow at release.

## How a named reach is admitted

```mermaid
flowchart LR
  B["block · the run's resolved principal"] --> T["tenant matches"]
  T --> O["isOrgAttributed"]
  O --> L["admitListedSession"]
  L --> V["ownResolverVerdict · or the host rule"]
  V --> W["ownsRecord · ownerPin"]
  W --> C["B's copy · the definition's checks run"]
```

The same functions the HTTP routes use, fed the run's resolved principal instead of HTTP
credentials. A miss at any step is a missing session.

## What stays as it is

- **The sessions handle** (`ctx.sessions`): another session's flow, readable state fields,
  history and lists. It reaches no resources, and another session's state stays
  readable-fields-only.
- **A block's own copy**, reached with no name, as today.
- **Per-row owners inside a shared copy** (`ownerPrivate`, `ownerWrites`).

## What's already here, and the debt

| Already here | What this does with it |
|---|---|
| The routes' admission: `admitListedSession`, `ownResolverVerdict` (`engine/src/routes/instance-caller.ts`), `isOrgAttributed` (`engine/src/context/org-attribution.ts`), `ownsRecord` with `ownerPin` (`engine/src/context/record-owner.ts`) | **Extends** to a block's caller ([ER-1](../../epics/FIX-2941/DECISIONS.md#who-owns-what)). No new owner check |
| `principalOwnsRequest` (`engine/src/context/request-principal.ts`) | **Builds on.** The host rule's owner compare |
| The request host's session reads (`engine/src/context/request-sessions.ts`): another session's flow and readable state, `undefined` on a miss | **Leaves alone**, and copies its miss shape |
| The resource resolver in `engine/src/context/createExecutionContext.ts`: own key, or the lineage root | **Extends** with a named session. The lineage branch stays until FIX-2947 deletes it |
| The change bus's one publish per write (`engine/src/bus/scope-changes.ts`) and the task notice | **Builds on.** A write into B publishes on B's topics, as a local write does ([ER-2](../../epics/FIX-2941/DECISIONS.md#who-owns-what)) |
| The wake store, which coalesces per tenant, session and entry (`coalesceWake`) | **Builds on** for turns started by another session's write ([D2](DECISIONS.md#d2)) |
| Dispatch type `webhook` (`core/src/types/dispatch.ts`) | **Builds on** to know a turn a webhook delivery started ([D1](DECISIONS.md#d1)) |
| `routeServiceEvent`, `fireOwnerRunThrough` and `dispatchInternalAs` (`engine/src/durability/owner-runs.ts`, `dispatch-internal.ts`), which dispatch a delivery's routing and owner runs as `internal` | **Extends:** each carries the delivery's origin on the envelope, so the runs it fires are fenced too ([D1](DECISIONS.md#d1)) |
| FIX-1283: two writers to one lineage-shared copy | **Answered.** A copy two sessions write is versioned at the store and guarded by the definition's checks, as two local writers are. No cross-session lock |
| Anything else that reaches another session's resources | **None.** Searched `sessionId`, `readFor`, `at(` and `session:` in `engine/src/context` and `core/src/types`. The parent-row read and settle on the request host (`core/src/types/request-host.ts`) is the one narrow case; FIX-2946 replaces it |

| Adds | Existing piece considered | How composed |
|---|---|---|
| `ctx.resources.at({ session })` | The sessions handle; the parent-row read | Extends the resource accessor. The handle reaches no resources, and a second handle beside it would be a second door to sessions |
| Block-side admission | The routes' admission functions | The same functions, fed the run's resolved principal |
| A delivery origin on internal dispatches | The dispatch source; request metadata | Rides the envelope beside the source, server-set. Metadata is caller-shaped, so it can't carry it (BP-031) |

| The debt | |
|---|---|
| **Removes** | Nothing by itself. It is what lets FIX-2946, FIX-2947 and FIX-2948 remove their workarounds |
| **Adds** | One accessor method. Two ways to name another session, `ctx.sessions` and `ctx.resources.at`, for two jobs (not a resource, a resource), which the docs line says. The webhook refusal, and the delivery origin it reads, are a stop-gap that FIX-2686 widens to every untrusted turn |
| **Leaves** | Tenants inside per-user data, and FIX-2065 |

**Net: flat here, down across the set.** One method is added. The set removes the workarounds it
replaces.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** reach admitted by the routes'
own functions, with every refusal reading as missing. If wrong: a block reaches a session a
browser can't, or a caller learns which ids exist.

**[The debt](#whats-already-here-and-the-debt), flat:** one method, and the workarounds go
elsewhere in the set. If wrong: `ctx.sessions` and `ctx.resources.at` read as two answers to one
question.

1. **[D1](DECISIONS.md#d1) · A turn a webhook delivery started, or a run it fires, reaches no
   other session; a board's settle on the claimed task's session and a subscription delivery are
   the two exceptions.** If wrong: a PR comment steers a worker into reading or changing another
   conversation, or a webhook worker that needs other reach waits for FIX-2686.
2. **[D2](DECISIONS.md#d2) · A turn started by another session's write is a wake on the owning
   session, which already coalesces.** If wrong: a burst of endings starts a burst of turns.

**Open: none.** D1 is the one to weigh. [DECISIONS.md](DECISIONS.md) has the reasoning.

Feature · `core` + `engine` · medium · epic FIX-2941
