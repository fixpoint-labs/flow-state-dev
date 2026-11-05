# FIX-2405 · Decisions

[Spec](SPEC.md) · **Decisions**

The epic settled the shape (FIX-2369 DECISIONS, "reuse: a move" for `readDevtoolUrl`), so one
call is left.

<a name="d1"></a>
## D1 · `traceHref(devtoolUrl, sessionId?)`, without the issue's `requestId`

| | Session only (chosen) | `requestId` too, as the issue sketches |
|---|---|---|
| The DevTool opens what the link names | yes | no: the DevTool has no request address, so the id would be dropped on arrival |
| New DevTool behaviour needed | none | a request address and its reader, a separate feature |

- **Because:** a link argument the DevTool ignores reads as working and isn't. Adding it later is
  an optional argument, not a break.
- **Locks in:** a link opens a session. A host that wants a request opens its session today.

## Decided, not asked

- **E1 · Lives in `config.ts`** beside `SESSION_ADDRESS_PARAM` and `readSessionAddress`, the
  other address helpers, as the issue says.
- **E2 · The meta name stays a private constant in devtool.** `fsdev` has its own
  (`DEVTOOL_URL_META`); devtool doesn't depend on the CLI, and the CLI doesn't need devtool's
  browser entry. The CLI's and Shift Manager's command tests pin the name on the writing side.
- **E3 · SSR-safe:** returns `undefined` with no `document`, matching the other readers there, so
  Kitchen Sink can call it during a Next.js prerender.
- **E4 · No app links here.** Wave 1 touches no app file but the copy it moves; the links land in
  the apps' own stacks.

## How it got here

- Drafted 2026-10-31 with the build beside it (the control is run on the build PR).
