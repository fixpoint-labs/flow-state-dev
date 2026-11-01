# FIX-2405 · *Open in DevTool* links, with the address reader shared

**Spec** · [Decisions](DECISIONS.md)

## Who feels it, before and after

| Someone who… | Today | After |
|---|---|---|
| **debugs a wrong delegate, a failed judge or a timeout in an app** | Opens DevTool by hand and hunts for one session id among many worker, task and run sessions | Clicks a *Trace* link next to the thing that went wrong (lands in each app's own stack, below) |
| **builds an app served by `fsdev dev --app`** | Only Shift Manager knows how to read the DevTool's address from the page; another app copies its reader and its link builder | Imports `readDevtoolUrl` and `traceHref` from `@flow-state-dev/devtool/react` |
| **works Shift Manager** | *Open trace* and a standing rule's *from a conversation* link work | The same links, built by the shared helper |

## The goal, and how we'll know it's met

**One reader for the DevTool's address and one builder for a link to a session, both in
`@flow-state-dev/devtool/react` beside `SESSION_ADDRESS_PARAM`, with Shift Manager's copy
deleted.** This is the epic's wave-1 package slice: it touches no app file except the Shift
Manager copy it moves out ([FIX-2369 build order](../../epics/FIX-2369/DECISIONS.md#coordination-seams)).

- **Smaller, and rejected:** leave the reader in Shift Manager and let each app copy it. That is
  the drift FIX-2369 D4 exists to stop.
- **Bigger, and not this slice:** the links in the apps. Kitchen Sink (its DevTool page passing
  `openSessionId={readSessionAddress()}`, and trace links in its harness and picked-session views)
  lands in KS `flow-state/page.tsx` stack 2 after FIX-2411. Both labs' *Trace* links (session or
  worker header, task sheet or popup, exchange popups, failed or interrupted entries) merge in
  order after each lab's adapter stack 3. Those PRs import from this one.
- **Not done if:** Shift Manager still holds its own reader or link builder, or a link the
  DevTool can't open (an address without the `?session=` its own reader takes).

**How we verify.**

- **Unit, `packages/devtool/test/devtool-url.test.ts`:** the reader takes the meta, takes nothing
  without it, and refuses a non-http(s) value; `traceHref`'s link round-trips through the
  DevTool's own `readSessionAddress`, keeps the DevTool address's path and query, and is the bare
  address with no session.
- **Control that must fail:** dropping the http(s) guard and renaming the query parameter fails
  three of those tests (run on the build PR).
- **Regression:** Shift Manager's existing trace-link tests (`task-screen`, `worker-settings-screen`)
  pass unchanged on the shared helper.

## What changes

- `@flow-state-dev/devtool/react` exports `readDevtoolUrl(): string | undefined` (moved from Shift
  Manager's `connection.ts`, now SSR-safe) and `traceHref(devtoolUrl, sessionId?)`.
- Shift Manager imports both and deletes its reader, its `traceHref` in `TaskInspector.tsx` and the
  hand-built URL in `StandingRules.tsx`. Its reader test moves to devtool.
- Docs: the devtool README's API section and the DevTool docs page on linking an app to a session.
  A changeset for `@flow-state-dev/devtool` (a new public export).

## What stays as it is

The meta itself (`fsdev dev --app` writes it; `fsdev` keeps its own constant), the DevTool's
`?session=` handling, and every app other than Shift Manager.

## What's already here, and the debt

| Piece | What this does with it |
|---|---|
| Shift Manager `readDevtoolUrl` in `src/lib/connection.ts` | **Moves** to devtool/react |
| Shift Manager `traceHref` in `TaskInspector.tsx`, URL building in `StandingRules.tsx` | **Replaced** by the shared `traceHref` |
| devtool/react `SESSION_ADDRESS_PARAM`, `readSessionAddress` | **Reused**: the link uses the parameter the reader takes |

**Adds:** two small exports. **Removes:** two copies. **Net:** smaller.

## Sign off

**Approve by merging.** The one call is dropping the issue's `requestId` argument
([D1](DECISIONS.md#d1)). *If wrong:* an optional argument added later, once the DevTool can open a
request by address.

Feature · `devtool/react`, `shift-manager` · small · 1 PR · wave-1 package slice of FIX-2369
