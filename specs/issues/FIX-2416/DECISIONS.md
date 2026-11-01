# FIX-2416 · Decisions

[Spec](SPEC.md) · **Decisions**

<a name="d1"></a>
## D1 · Seed the controls from the session's `modeStatus` record

| | Seed from `modeStatus` (chosen) | A session action, like `setSelectedModel` | Browser storage per session, like the draft |
|---|---|---|---|
| Remembers what a turn ran with | yes | yes | yes, on this browser only |
| Remembers an unsent change | no | yes | yes |
| New server surface | none | a new action and a state write on every click | none |
| Another device or tab sees it | yes | yes | no |

- **Because:** the server already stores all three values on every turn. The issue gives a session
  action or draft-style storage as options for features. Neither is needed, because features are
  recorded too (`run/steps.ts`).
- **Locks in:** a change the user never sent is not remembered. The issue does not ask for that, and
  it would need a session action. If it is wanted later, the hook's interface does not change.
- **Guard:** `useSession` keeps the previous session's snapshot until the new one loads. So the page
  gives the hook the record only when `snapshot.sessionId` is the open session. Without this guard,
  switching sessions would seed the new session with the old one's controls.
