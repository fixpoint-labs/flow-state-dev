# FIX-1549 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. "The writer" is Workforce's branded private roster collection,
`defineHiredRosterPrivateCollection()`. "Armed" means the registry holds, or has held, a flow
whose resources include it. "Overlaps" means the fence's existing test: the pattern can resolve
onto a user-owned roster key.

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

## What stays exactly as it is

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | Bob opens Alice's user-owned seat, or lists the writer from his session | `404 Unknown flow`, and her row is absent from his list | Existing `hire-plane-fence` suite, unchanged |
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

**Deployment rule this issue introduces (D1).** A Workforce app whose flows are split across
processes over one store registers the writer in every process that serves app flows.
