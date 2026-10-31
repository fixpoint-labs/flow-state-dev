# FIX-2371 · Decisions

[Spec](SPEC.md) · **Decisions**

The issue settles the what: keep the draft until a send lands, offer Retry on a failure, and
keep Shift Manager's draft across a reload. The epic spec places it in the apps. Two calls
remain: where the reload half lives, and whether the conversation draws a *sending* line.

<a name="d1"></a>
## D1 · The draft hook moves into `@flow-state-dev/react` · engineering, decided

| | Lift Kitchen Sink's hook into `react` (chosen) | Copy it into Shift Manager | Only Shift Manager, its own |
|---|---|---|---|
| Implementations of "keep a box's text across a reload" | one | two | two, written differently |
| Labs get it too | one line each | another copy each | no |
| Workforce noun below the client (ER-1) | none: a draft is a box's text | — | — |
| Kitchen Sink change | import swap, its copy deleted | none | none |

- **Because:** FIX-2369's ER-3 is one implementation per need, and the adopting PR deletes the
  app's copy. Labs import nothing from each other or from Kitchen Sink, so a shared hook has to
  live in a package, and the noun is `react`'s.
- **Keys stay where they are.** `useDraft(namespace, id)` stores under `<namespace>:<id>`.
  Kitchen Sink passes `kitchen-sink:composer-draft`, which is the key its copy wrote, so drafts
  stored before the change are still read (BP-030).
- **Locks in:** a public hook in `react`, `localStorage` only. A host that wants drafts on the
  server builds that itself; nothing here makes storage pluggable.

<a name="d2"></a>
## D2 · The box holds the line while it sends; the feed draws no *sending* line · product, decided

The issue's outcome says "append the user's line as *sending*", then swap it for the stored item.
This spec keeps the line in the box instead, marked *Sending…*, until the request lands.

- **Because:** both labs' feeds draw what their adapter reads from the session. A line drawn
  before the server stores it is a client-side entry in each adapter, which is FIX-2376's
  *queued* line on FIX-2374's session feed, and both labs' `adapter.ts` stack 1 in the epic's
  build order. Building it here puts a second one in front of theirs.
- **What the person loses:** nothing they can act on. A send resolves in well under a second on
  a live server; the line is visible the whole time, in the box, and on a failure it is still
  there to retry or edit.
- **What would change it:** FIX-2376 landing a pending line in the feed. Then the box can empty
  on submit, since the feed holds the line until it lands or fails.

## Decided, not asked

- **E1 · Retry in the labs is always offered**, with the reason. Shift Manager's three-way split
  (refused, not sent, unconfirmed) stays Shift Manager's; the labs' adapters reject with a plain
  error, and the person can see in the conversation whether the line landed.
- **E2 · A success clears the box only if the text is unchanged**, as Shift Manager and Kitchen
  Sink already do: anything typed while the send ran stays.
- **E3 · Send is disabled while a send runs**; the box stays editable.
- **E4 · Shift Manager keys:** a conversation by its worker id, a task by its task id, an Inbox
  reply by its ask's suspension id, under one `shift-manager:draft` namespace.
- **E5 · Labs store per session** (`claude-code-style:draft`, `teammates:draft`). Switching
  sessions still shows that session's own draft, so the existing "a draft never reaches another
  session" tests hold.
- **E6 · No changeset is required for the labs or Shift Manager;** `@flow-state-dev/react` gets a
  `patch` fragment for the new export, as `isSendKey` did.

## How it got here

- Drafted 2026-10-31 from the issue, the FIX-2369 epic spec (ER-1, ER-3, ER-4, the build order)
  and the four composers on `main` at 675f614. The build was prototyped beside it.

## Notes from review

None yet.
