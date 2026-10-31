# FIX-2416 · Flow State's session controls are remembered by the session

**Spec** · [Decisions](DECISIONS.md)

## Who feels it, before and after

| Someone who… | Today | After |
|---|---|---|
| **reloads a Kitchen Sink Flow State session that ran in Build** | It reopens in Ask. The artifact panel is gone, and the next message runs in Ask | It reopens in Build, with the artifact panel open |
| **switches between two sessions** | Each one shows the last session's mode, thinking style and features | Each one shows what it last ran with |
| **opens a new session** | Ask and the default style and features | No change: Ask and the defaults |
| **changes a control and then switches away without sending** | Lost | Still lost. Nothing has run with it, so the session has no record of it |
| **changes the model or the thinking toggle** | Remembered (stored per user) | No change |

## The goal, and how we'll know it's met

**A Flow State session reopens on the mode, thinking style and features it last ran with.**

- **The real need:** [epic FIX-2369](../../epics/FIX-2369/SPEC.md) makes the apps usable every day. A
  session that reopens in the wrong mode runs the next message wrongly, and the user may not notice.
- **Smaller, and rejected:** remember mode only. Thinking style and features would still reset, and a
  turn would run with search on after the user turned it off.
- **Bigger, and not this issue's:** remembering a control the user changed but never sent. That needs
  a new session action for a case the issue does not ask for ([D1](DECISIONS.md#d1)).
- **Not done if:** a session that ran in Build reopens in Ask after a reload, or a new session opens
  with the previous session's controls.

**The check.** A Kitchen Sink e2e test (`e2e/mode-switching.spec.ts`, "a session reopens in the mode
it last ran in") sends a message in Build, reloads, and expects the mode selector to read Build. On
`main` it fails ("Ask"). A unit test of the hook covers the defaults for a new session, a session
switch, and a choice made before the record loads.

## What changes

App glue only, in `apps/kitchen-sink`. The `run` action already writes mode, thinking style and
features to session state on every turn, and the flow already projects them as the `modeStatus`
client data. The page never reads them back. A small hook keeps the three controls for the open
session and seeds them from that record, once per session. The page gives the hook the record only
when the snapshot belongs to the open session.

Documentation: no documentation impact. This is a fix to how the reference app behaves; no page
describes these controls resetting.

## What stays as it is

- The flow, its actions and its session state schema. No new action.
- The model and thinking toggle, which stay user preferences.
- `@flow-state-dev/react` and the other packages ([ER-1](../../epics/FIX-2369/DECISIONS.md#who-owns-what)).

## What's already here, and the debt

- **Reused:** the `modeStatus` projection in `flows/chat-agent/flow.ts`, and the render-time reset
  that `lib/use-session-draft.ts` uses.
- **Adds:** one hook file of about 100 lines and its test. **Removes:** three `useState` calls from
  `app/flow-state/page.tsx`. Net: no new debt.

## Sign off

- **The goal**: a session reopens on what it last ran with. *If wrong:* the hook is deleted and the three `useState` calls come back.
- **The debt**: neutral. One hook replaces three pieces of page state. *If wrong:* one file to delete.
- **D1** · [seed from the record the server already keeps](DECISIONS.md#d1). *If wrong:* a session action is added later; the hook keeps its shape.
- **Open: none.**

Improvement · `apps/kitchen-sink` · S · epic FIX-2369 wave 0 · implementation #4383
