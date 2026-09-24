# FIX-1549 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Terms:

- **An owner-private collection** declares `ownerPrivate: { param }`. Workforce's
  `defineHiredRosterPrivateCollection()` is one.
- **An owner key** is a stored key with a segment beginning `~`.
- **Its owner segment** is the first such segment. `ownerSegment(userId)` builds one: `~` plus
  `encodeUserSegment(userId)`. A later segment beginning `~` is ordinary data. The owner is read
  off the key alone, so every process agrees on it.
- **Armed** means the registry holds, or has held, a flow declaring an owner-private collection.
- **Reaches** means a collection in the owner-private collection's scope has a pattern that can
  resolve onto a key the owner-private pattern matches (segment by segment: a literal meets an
  equal literal, a parameter or `*` or `**`). Storage is routed by scope, and patterns may overlap
  across scopes ([resource collections](../../../docs/architecture/resource-collections.md#patterns)),
  so a collection in another scope never reaches.

Rule numbers are kept from the approved set where the rule survives. BR-20 to BR-24 are new.

## At definition

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | An app defines a collection with any valid pattern, `workforce/roster/**` included | `defineResourceCollection` applies only generic checks. No roster message on any path | CI · the corpus, define column |
| BR-8 | An owner-private collection enables any browser read (`client.state.read`, `client.content.read` or `client.content.prefetch`), names a parameter its pattern does not declare exactly once, or uses `**` | Refused at definition, with the pinned message. Moved from registration | CI |

## A registry that is not armed

| # | When | Then | Proved by |
|---|---|---|---|
| BR-2 | A flow declares a pattern that would reach Workforce's rows (`**`, `[tenant]/**`, `[a]/[b]/[c]/[d]`, `workforce/roster/[owner]/notes`) | Registered | CI · the corpus, register column |
| BR-3 | A flow declares `workforce/roster/[owner]/[seat]` without `ownerPrivate` | Registered. It is an ordinary pattern here | CI |

## An armed registry

| # | When | Then | Proved by |
|---|---|---|---|
| BR-4 | The owner-private collection registers first, then a flow whose collection reaches it | The second registration is refused with the overlap message | CI · the corpus replayed armed |
| BR-5 | The overlapping flow registers first, then the owner-private collection | The owner-private registration is refused, naming the earlier flow and its pattern. The registry is left as it was | CI |
| BR-6 | One flow declares both | Refused | CI |
| BR-7 | A copy of the owner-private pattern without `ownerPrivate`, either order | Refused with the overlap message (today: "cannot be redeclared") | CI |
| BR-9 | The declaring flow is unregistered, then an overlapping flow registers | Refused. The fence stays armed | CI |
| BR-10 | The same owner-private declaration (pattern, parameter, scope) on two flows; or beside `workforce/roster/*` | Registered. Neither reaches an owner key the other can't | CI · existing suite |
| BR-20 | Two owner-private collections in one scope that reach each other with a different pattern or parameter | Refused with the overlap message | CI |
| BR-24 | A collection in a different scope from the owner-private one, whatever its pattern: a session-scoped `[tenant]/**`, or the same owner-private declaration at `user` scope | Registered. It cannot reach those rows. The key fence still governs its own keys | CI |
| BR-11 | A flow registered at runtime, with a pin | Checked like any other | Existing suite |

## Every app · the rows themselves

These hold armed or not, in every process, whatever it registered.

| # | When | Then | Proved by |
|---|---|---|---|
| BR-15 | A collection that is not owner-private lists or counts a scope holding an owner key | The key is absent from list and count | CI · [poc/unarmed-leak](poc/unarmed-leak/README.md) inverted |
| BR-16 | It reads an owner key by name | `getOptional` is absent; `get` is refused with the row message, which does not say whether the row exists | CI |
| BR-17 | It creates, upserts or deletes an owner key | Refused with the row message. The row is unchanged | CI |
| BR-18 | The request-start seed cache, projected collections, the browser resource routes, `/state` and the debug endpoints serve such a collection | The same answers as BR-15 to BR-17, through each | CI · #2196's read-path suite, predicate swapped |
| BR-19 | A process that never registered an owner-private collection runs over a store holding Alice's row, with an overlapping collection admitted | Bob's list through it is empty | CI · [poc/unarmed-leak](poc/unarmed-leak/README.md) inverted |
| BR-21 | An owner-private collection reads or writes a key | Served only when the key's owner segment sits at its owner parameter and is `ownerSegment(caller)`. A later `~` segment is data. With no caller, nothing is served. Otherwise it answers as BR-15 to BR-17 | CI |

## What stays as it is

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | Bob opens Alice's user-owned seat, or lists the private collection from his session | `404 Unknown flow`, and her row is absent from his list. Alice still reads her own row. `InstancePinMismatchError.reason` is `"owning-user"` where it was `"roster-owner"`; its sentence is unchanged | Existing suites and `goals/hire-plane/*`, re-run |
| BR-13 | The debug endpoints list the roster | Another user's private row stays out | Existing suite |
| BR-14 | Any pattern a Workforce app was refused on `main`, declared at the roster's `org` scope | Still refused. The message is the pinned generic one. Another scope is BR-24 | CI · corpus equivalence, armed |
| BR-22 | A row written before this change, at `workforce/roster/~<user>/<seat>`, including a seat id that begins `~` | Read back through Workforce's private collection with no migration | CI · rows planted store-direct |
| BR-23 | Anyone searches `packages/engine/src` for Workforce coupling: an import of `@flow-state-dev/workforce`, a roster symbol Core exports today, the `workforce/roster` key, the `"roster-owner"` reason, a `hire-plane` module | No hit. Prose is reviewed in PR-B, not grepped | CI · a guard test |

## Failure taxonomy

Registration refusals throw, which at startup means the app does not start. Definition refusals
throw when the module loads. Row refusals throw from the handle and answer `403` from a route;
row absence reads as not found. Nothing degrades and nothing retries. A refused registration
leaves the registry unchanged.

## Acceptance criteria this issue owns

A test app that installs nothing from Workforce registers `[tenant]/**` and
`workforce/roster/[owner]/notes`, and writes and lists through both. The same flow beside
Workforce's private collection is refused at startup. With Alice's row already in the store, the
first app's lists never show it. A second test app declares its own owner-private collection and
gets the same fence, with no Workforce import. Engine's source names no Workforce concept.

**Reserved key shape (D5, Jake's lock).** In every app, a key with a segment beginning `~`
belongs to an owner-private collection, and its first such segment is its owner. No other
collection reads or writes one. No deployment rule.
