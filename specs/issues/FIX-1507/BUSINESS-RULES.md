# FIX-1507 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. Every row is **today's behaviour**, and it must hold after the move.
"The five reads" are the panels' row read and item read, the flow list, and the leaf's session
list, plus the live board, which is the row read with a re-read hook. *Char* means a
characterization test written and green on `main` before any source moves; *existing* means a
test already pins it.

## Late and racing responses — the five reads

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A response lands after its read's identity changed (a panel's session or collection, the host's client, the leaf's address, user or dispatch-run flag) | It is discarded. The read shows loading, no rows, no error, for the new identity | Existing for the leaf list · **char** for the flow list, the row read and the item read |
| BR-2 | Two reads of the same identity race (mount against a refresh) and the older resolves last | The older never overwrites the newer | Existing for the leaf list · **char** for the other three |
| BR-3 | A read fails after a newer read of the same identity started | The failure is discarded; no error is shown | **Char**, one panel read and one navigator read |
| BR-4 | The identity changes while rows are drawn | The previous identity's rows are never returned, not even for the render before the reset lands | Existing for the leaf list · **char** for the flow list and the row read |
| BR-5 | The component unmounts mid-read | Nothing is written after unmount | Existing (`useReadFence` suite) |

## What a read shows

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | A read fails with an `Error` that has a non-blank message | That message is the error | Existing for the flow list and panels · **char** for the leaf list |
| BR-7 | A read fails with anything else, or a blank message | The read's own fallback text: "Failed to load flows", "Failed to load sessions", or the panel's own | **Char**, one per read |
| BR-8 | A read is refreshed after a failure | It loads again; it never retries on its own | Existing |

## Timing and requests

| # | When | Then | Proved by |
|---|---|---|---|
| BR-9 | A read mounts | Exactly one request, with exactly today's arguments (no `userId` key when there is none; the dispatch-run flag only when on; page size and cursor as today) | Existing, plus **char** call-count assertions for the flow list and the item read |
| BR-10 | The host re-renders with the same identity (a fresh array of the same values, a new callback) | No new request | **Char**, one panel and one navigator list |
| BR-11 | Two navigator sections render | One flow-list read (FIX-1477 BR-10) | Existing |
| BR-12 | A live board hears a change to its board | It reads again, coalesced as today | Existing (`board-list` suite) |

## The closed leaf

| # | When | Then | Proved by |
|---|---|---|---|
| BR-13 | A leaf mounts closed | No request. It reports no sessions, **loading**, no error | Existing for "no request" · **char** for loading and error |
| BR-14 | A closed leaf is refreshed | No request | **Char** (D1: the reason the switch exists) |
| BR-15 | A response lands after the leaf closed, or a refresh from an earlier visit runs | Discarded; nothing is read | Existing |
| BR-16 | A leaf reopens | A fresh read; the last visit's rows are never shown | Existing |

## Client set-up and the public edge

| # | When | Then | Proved by |
|---|---|---|---|
| BR-17 | A host passes its own client to a panel | Every read goes through it (FIX-1477 BR-29) | Existing |
| BR-18 | A host passes none | The panel builds one from the provider's address; `BoardList` from its own address and transport when given | Existing |
| BR-19 | The provider's address changes and no client was passed | A new client is built and the read re-fences on it: the old address's late response is discarded | **Char**, one panel |
| BR-20 | Anyone imports the package | The export list is identical to `main`; neither new helper is exported | CI · diff of the package's exports |

## Failure taxonomy

Nothing here is fatal and nothing retries. Every failure is today's: a read error becomes the
read's error text, and a refresh is the only retry. A late or superseded response is silent by
design.

## Acceptance criteria this issue owns

Every row above holds after the move, with the characterization tests committed alone first and
unedited since. The planted control in [PLAN V2](PLAN.md#checks) turns BR-2 red for a panel read
**and** a navigator read at once.
