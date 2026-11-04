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
  it would need a session action. If it is wanted later, the persistence moves behind the hook and
  the page's side stays as it is: the turn still receives mode, thinking style and features.
- **Guard:** `useSession` keeps the previous session's snapshot until the new one loads. So the page
  gives the hook the record only when `snapshot.sessionId` is the open session. Without this guard,
  switching sessions would seed the new session with the old one's controls. As shipped, the guard
  sits at the page's one call site, and the hook's contract says a caller passes no record while its
  snapshot belongs to another session.

## Notes from review

Recorded from the spec PR's review; none changes the approach.

- **Overlay instead of owned state.** Suggested: derive the controls from `modeStatus` and hold
  local state only for unsent edits. Shipped as owned state with a one-way "settled" mark (the
  record was applied, or the user chose first). Same behaviour; the mark is what keeps a refresh of
  the record from overwriting a choice made after seeding.
- **Guard inside the hook.** Suggested: the hook takes the snapshot and checks the session id
  itself. Shipped with the check at the page, as D1 says; there is one call site.
- **Types.** The hook takes `Mode`, `ThinkingStyle` and `Features` from the selector components the
  page already uses. The page's `modeStatus` cast now includes `features`.
