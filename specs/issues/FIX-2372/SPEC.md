# FIX-2372 · Every mutation button shows busy and failed states

**Spec** · [Decisions](DECISIONS.md)

## Who feels it, before and after

| Someone who… | Today | After |
|---|---|---|
| **double-clicks *Resolve*** in the Claude Code-style lab (task card or task view) | Two review answers are sent | One is sent; the button is held until it settles |
| **pins, steers or requests changes** and the call is refused | Nothing shows; it looks like it worked, and a steer's words are already gone from the box | The refusal shows next to the button, and the words stay in the box |
| **picks a project for a new session** and the session can't open | Stays on the picker with nothing shown; a second click may open two | The picker says why; picking is held while the session opens |
| **clicks *Talk*** in Kitchen Sink's workers panel while a session is being created | A second click starts a second create | Every *Talk* is held until the open settles; the clicked one reads *Opening…* |
| **hires, edits or answers** in the Teammates lab | Already held, with the refusal shown | Unchanged, from the shared hook |

## The goal, and how we'll know it's met

**Every button that changes something, in these apps, sends its call once and shows a refusal
inline. One hook does it, in `@flow-state-dev/react`.**

- **Smaller, and rejected:** a copy of Teammates' `useSubmit` in each app. That is three copies
  of the same twenty lines, which D4 and ER-3 of [FIX-2369](../../epics/FIX-2369/DECISIONS.md#who-owns-what)
  refuse ([D1](DECISIONS.md#d1)).
- **Bigger, and not this issue's:** the main composer's send and stop, owned by FIX-2370's
  request-recovery component; the roster going stale, owned by the live-roster item.
- **Not done if:** a double click on any listed button records two calls, or a refused call
  leaves no message on screen.

**How we verify.**

- **Unit, `packages/react/test/useSubmit.test.ts`:** busy while the action runs, error kept on
  refusal and cleared on the next try, no throw.
- **Lab screen, `labs/claude-code-style/test/mutation-buttons.test.tsx`:** on the fake adapter
  with one call swapped for one the test settles: double-click Resolve (card) sends once and
  shows the refusal; Request changes holds the review buttons and keeps the words on refusal; a
  steer clears its words only once taken; a refused pin says so; a double-clicked project opens
  one session and the picker shows the refusal.
- **Kitchen Sink, `apps/kitchen-sink/test/team-panel.test.tsx`:** double click on *Talk*, then a
  click on another worker, records one open; the refusal shows; the buttons come back.
- **Controls that must fail:** each of those app tests run against `main`'s components. All
  five lab cases and the Kitchen Sink case fail there (produced on the build PR, #4376).
- **Regression:** the Teammates lab's existing tests pass on the shared hook unchanged.

## What changes

- **`@flow-state-dev/react` exports `useSubmit(action)`** → `{ busy, error, submit(event?, ...args) }`,
  Teammates' contract moved as is. Not named `useAction`: that name is the package's flow-action
  hook ([D1](DECISIONS.md#d1)).
- **Teammates** imports it and deletes `src/lib/use-submit.ts`.
- **Claude Code-style lab:** Resolve, Request changes, Pin/Unpin, the task view's steer or
  answer, and the project picker use it. The task view's three composer calls share one hold.
  A steer's words leave the box only once taken.
- **Kitchen Sink:** the workers panel's *Talk* uses it, holding every row while one opens.

## What's already here, and the debt

| Piece | Today | After |
|---|---|---|
| Teammates `src/lib/use-submit.ts` | The only copy | **Removed**; imports the package hook |
| `@flow-state-dev/react` `useAction` | Runs one flow action, with `loading`/`error` | Unchanged. It needs a flow kind and a user and sends to a flow, so it can't wrap an adapter call ([D1](DECISIONS.md#d1)) |
| Kitchen Sink's *Talk* error line | Catches and shows a refusal | Same line, now from the hook |

**Adds:** one exported hook, about twenty lines, with no flow or workforce noun (ER-1 holds).
**Net:** one implementation where there would be three; one copy removed.
