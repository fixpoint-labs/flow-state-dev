# FIX-1549 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. "The writer" is Workforce's branded private roster collection,
`defineHiredRosterPrivateCollection()`. "Armed" means the registry holds, or has held, a flow
whose resources include it. "Overlaps" means the fence's existing test: the pattern can resolve
onto a user-owned roster key. "A user-owned key" is a stored key under `workforce/roster/~`,
the shape the writer stores a user-owned row under.

## An app without the writer

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | An app defines a collection with any valid pattern, `workforce/roster/**` included | `defineResourceCollection` applies only its generic checks. No roster message on any path | CI · the corpus, define column |
| BR-2 | A flow in a registry that is not armed declares an overlapping pattern (`**`, `[tenant]/**`, `[a]/[b]/[c]/[d]`, `workforce/roster/[owner]/notes`) | Registered | CI · the corpus, register column |
| BR-3 | A flow in a registry that is not armed declares `workforce/roster/[owner]/[seat]` without the brand | Registered. It is an ordinary pattern here; nothing writes user-owned rows | CI |

## An app with the writer

| # | When | Then | Proved by |
|---|---|---|---|
| BR-4 | The writer is registered first, then a flow declaring an overlapping pattern | The second registration is refused, with today's message | CI · the corpus replayed armed |
| BR-5 | A flow declaring an overlapping pattern is registered first, then the writer | The writer's registration is refused, naming the earlier flow and its pattern. The registry is left as it was | CI |
| BR-6 | One flow declares both the writer and an overlapping collection | That registration is refused | CI |
| BR-7 | An unbranded copy of `workforce/roster/[owner]/[seat]` in an armed registry, either order | Refused: "cannot be redeclared", as today | CI |
| BR-8 | The writer declares a browser read | Refused, armed or not | CI |
| BR-9 | The writer's flow is unregistered, then an overlapping flow registers | Refused. The fence stays armed, because the rows outlive the registration | CI |
| BR-10 | Two writers on two flows, or the writer plus `workforce/roster/*` | Registered. Neither overlaps a user-owned row the other can't already reach | CI · existing suite |
| BR-11 | A hired seat is registered at runtime through the same registry | Checked like any other flow | Existing suite |

## Every app · the rows themselves

These hold armed or not, in every process, whatever else the process registered.

| # | When | Then | Proved by |
|---|---|---|---|
| BR-15 | Any collection other than the writer lists or counts a scope that holds a user-owned key | The key is absent from its list and its count | CI · [poc/unarmed-leak](poc/unarmed-leak/README.md) inverted |
| BR-16 | It reads a user-owned key by name | As another user's row reads through the writer today: `getOptional` is absent, `get` is refused with the writer's message, which does not say whether the row exists | CI |
| BR-17 | It creates, upserts or deletes a user-owned key | Refused, with the writer's message. The row is unchanged | CI |
| BR-18 | The browser resource routes and the debug endpoints serve such a collection | The same answers as BR-15 and BR-16 through each route | CI |
| BR-19 | A process that never registered the writer runs over a store holding Alice's row, with an overlapping collection admitted | Bob's list through it is empty | CI · [poc/unarmed-leak](poc/unarmed-leak/README.md) inverted |

## What stays exactly as it is

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | Bob opens Alice's user-owned seat, or lists the writer from his session | `404 Unknown flow`, and her row is absent from his list. Alice still reads her own row through the writer | Existing `hire-plane-fence` suite, unchanged |
| BR-13 | The debug endpoints list the roster | Another user's private row stays out | Existing suite |
| BR-14 | Any pattern the armed fence refused on `main` | Still refused, with the same message | CI · corpus equivalence, armed |

## Failure taxonomy

Every refusal is a thrown error at registration, which at startup means the app does not start,
as today. Nothing degrades and nothing retries. A refusal leaves the registry unchanged, the
rule every registration check already follows.

## Acceptance criteria this issue owns

A test app that installs nothing from Workforce registers a flow declaring `[tenant]/**` and
`workforce/roster/[owner]/notes`, and runs an action that writes and lists through both. The
same flow beside the writer is refused. Neither app's code differs except for the writer.
With Alice's user-owned row already in the store, the first app's lists never show it.

**Reserved key shape this issue introduces (D1).** In every app, keys under
`workforce/roster/~` belong to Workforce's private roster writer. No other collection reads or
writes them. There is no deployment rule: a process without the writer needs no setup to stay
closed.
