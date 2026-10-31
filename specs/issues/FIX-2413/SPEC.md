# FIX-2413 · Interrupting a run takes a deliberate gesture, never a bare Esc

**Spec** · [Decisions](DECISIONS.md)

Improvement · Shift Manager, Claude Code-style lab, `@flow-state-dev/react` · small · 1 PR ·
wave 0 of epic [FIX-2369](../../epics/FIX-2369/SPEC.md) (merged in #4358)

## Who feels it, before and after

| Someone who… | Today | After |
|---|---|---|
| **presses Esc in Shift Manager's task frame while a run works**, to leave a field or close something | The run is aborted at once. No confirm, no undo | Nothing stops. The activity line says *press Esc again to interrupt* for 1.5 s |
| **means to stop the run** | One Esc | Esc twice within 1.5 s, or Cmd+. (Ctrl+. off a Mac), or the Interrupt button |
| **presses Esc while typing in Shift Manager's composer** | Aborts the run | Esc is the text box's. It never counts toward an interrupt. Cmd/Ctrl+. still works there |
| **has a sheet open over the Claude Code-style lab's thread, with the composer focused**, and presses Esc | One press closes the sheet **and** stops the turn | The sheet closes. The turn keeps going |
| **presses Esc in the lab's composer** | Stops the turn | Nothing. Cmd/Ctrl+. or Stop ends the turn; Esc Esc does from anywhere else on the page |
| **looks at a Shift Manager run they interrupted** | *interrupted* | *Interrupted · run stopped at 14:32*, the time the run's record says it ended |
| **reads the Interrupt button's title and the hint** | *Stop this run (Esc)*, *esc to interrupt* | *Stop this run (Esc Esc or ⌘.)*, *esc esc to interrupt*; Ctrl in place of ⌘ off a Mac |

Esc is the reflex key for "get me out of this". Both apps bound it to a destructive stop on
runs that can be an hour of coding work. Esc keeps its one meaning, dismiss; a stop takes a
second, deliberate press or a chord nobody hits by accident.

### The goal, and how we'll know it's met

**Goal:** no single keystroke that also means *dismiss* stops a run, in either app.

**Is it the right goal?** The report item (R-47, impact 4/5) is about lost work, and an accidental
stop is the only way this surface loses it. A confirm dialog would also meet it, but would put a
second dismissable thing in front of the person at the moment they want out.

**The check.** Two component tests, one per app, plus the helper's unit test:

- Shift Manager: with a live run, one Esc on the frame, and one Esc in the composer, send no
  abort; Esc Esc within the window sends exactly one; Cmd+. sends one; Esc, a wait past the
  window, Esc sends none.
- Lab: with a sheet open and the composer focused, one Esc closes the sheet and leaves `onStop`
  uncalled.

**The control that must fail.** Restore today's single-Esc handler in `TaskFrame.tsx` (and the
composer's Esc branch in the lab): the *one Esc sends no abort* rows go red. The PR shows that
red run.

## What changes

`@flow-state-dev/react` gains the gesture, next to `isSendKey`, so both apps read one rule
([D1](DECISIONS.md#d1)):

```ts
/** Feed it keydowns; it says when a press completes an interrupt. */
export function createInterruptKeys(options?: { windowMs?: number }): {
  /** "interrupt": stop now · "armed": first Esc, show the hint · null: not ours. */
  press(event: InterruptKeyEvent, now?: number): "interrupt" | "armed" | null;
  reset(): void;
};

/** The same, as a hook: `armed` drives the hint and clears itself after the window. */
export function useInterruptKeys(options: {
  enabled: boolean;
  onInterrupt: () => void;
  windowMs?: number;
}): { armed: boolean; onKeyDown: (event: InterruptKeyEvent) => void };
```

The rule it holds: Cmd/Ctrl+. interrupts at once. Esc arms; a second Esc inside the window
interrupts. An Esc whose target is a text field (textarea, input, contenteditable), or whose
default was already prevented (something dismissed on it), neither arms nor fires, and resets
any arming. An Esc during IME composition is the input method's.

- **Shift Manager** `TaskFrame.tsx`: the frame's `onKeyDown` goes through the hook; the
  activity line shows the armed hint; the button title and hint change as in the table; an
  aborted run reads *Interrupted · run stopped at HH:MM* from the record's `completedAtMs`
  (plain *interrupted* when the record has none). `JumpTo.tsx` prevents the default on the Esc
  it closes with.
- **Claude Code-style lab**: the composer loses its Esc branch; the thread view takes the hook
  for the turn; `Sheet.tsx` closes on a capture-phase listener and prevents the default, so the
  Esc that closed it is spent. The hint under the composer changes to match.
- **Engine, one line:** the request status route fills `completedAtMs` for an aborted or failed
  request from the time it stopped (`abortedAt`, `failedAtMs`). Its type already promises "the
  time the request reached a terminal status"; today only a completed request gets it, so an
  interrupted run has no time to show.
- **Docs:** the react README gains `createInterruptKeys` / `useInterruptKeys` beside
  `isSendKey`; a changeset for `@flow-state-dev/react` (a new export a consumer can use).

## What's already here, and the debt

| Piece | What it does today | This change |
|---|---|---|
| `isSendKey` (`@flow-state-dev/react`) | The one send shortcut every box shares | Kept. The interrupt rule sits beside it in the same shape: a pure check plus docs |
| `TaskFrame` frame `onKeyDown` | Esc anywhere stops the run | Replaced by the hook |
| `TaskProvider.requestInterrupt` (`task.tsx`) | The one abort write; waits for the record | Unchanged. The deliberate gesture is the confirm, so no confirm step is added here |
| Lab `Composer` Esc branch, `Sheet` document listener | Stop on Esc; close on Esc, both on one press | Esc branch removed; Sheet's listener spends the Esc |
| FIX-2340 (backlog) | Will lift the labs' sheet into `packages/ui` | Carries the capture-and-prevent rule with it. Build order: FIX-2340 → 2413 → 2401 lists 2340 first, but it has not started and this change is two lines in `Sheet.tsx`, so 2413 does not wait |

| Request status route (`engine`) | `completedAtMs` only on a completed request | Also on an aborted or failed one, as its type documents. Generic, no workforce noun |

**Adds:** one small module and one hook in `@flow-state-dev/react` (no workforce noun; ER-1).
**Removes:** two app-local Esc-stops. **Net:** one rule for a stop key instead of two, and the
next app with a stop button reaches for it instead of writing a third.

## What stays as it is

- The Interrupt button and the lab's Stop button: one click still stops. A click is deliberate.
- Shift Manager's *stopping… (not stopped until the run says so)* line, and the rule that the
  screen says *interrupted* only once the record reads `aborted`.
- Every Esc that dismisses: Jump to, the lab's sheets, the Teammates session popup.
- Teammates: it binds no stop key today and gets none here (FIX-2401 owns the labs' sheets
  after this, and leaves stop keys to this issue).

## Sign off

1. **[D1](DECISIONS.md#d1) · The gesture lives in `@flow-state-dev/react`, not copied into each
   app.** If wrong: a small published export to deprecate later; the two apps keep working.

**Open: none.** Window length, the text-field rule, the time source and the hint wording are
decided in [DECISIONS.md → Decided, not asked](DECISIONS.md#decided-not-asked).
