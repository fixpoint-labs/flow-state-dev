# FIX-2414 · Decisions

[Spec](SPEC.md) · **Decisions**

## Decided, not asked

| Call | Why |
|---|---|
| **Which controls become links: every control whose job is "go to that address"** | The issue names six surfaces; the same gap is on the Roster, Messages, back links and a task's linked rows. Fixing six and leaving the rest makes the static check a list of exceptions that aren't reasons |
| **Which stay buttons: controls that change what this screen shows** (tabs, the group-by and team toggles, Inbox's list, Jump to's Enter key) | They are selections within a screen, not places someone opens in a new tab. Each is named, with its reason, in the static check, so a new one fails until someone writes down why |
| **A Tasks row keeps its whole-row click** | A wide click target is what users have now. The title is the link (Tab, Enter, Cmd-click, copy); the row ignores clicks on the link and modified clicks, so one click never navigates twice |
| **`RouteLink` lives in `src/components/RouteLink.tsx`, not `src/lib/routes.ts`** | It is JSX; `routes.ts` stays a plain module and isn't renamed. The issue's location was a pointer, not a constraint |
| **A link with another `target` is the browser's** | `target="_blank"` means "not this tab"; handling it in place would contradict it |

No numbered decision: the issue already settled the approach, and nothing here is costly to
reverse.

## Notes from review

None yet.
