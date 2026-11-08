# FIX-2521 · Decisions

[Spec](SPEC.md) · **Decisions**

**No decisions of its own.** Kitchen Sink is glue ([its CLAUDE.md](../../../apps/kitchen-sink/CLAUDE.md#what-belongs-here-and-what-belongs-in-the-framework)):
each choice a person sees here is made in a package or by the epic, and this issue wires it in.
Those calls, so nobody re-derives them here:

| What a person sees | Whose call |
|---|---|
| The +, paste, drop, previews, refusals, upload on attach | FIX-2518 [D1](../FIX-2518/DECISIONS.md#d1), [D2](../FIX-2518/DECISIONS.md#d2) |
| What the model gets from earlier turns | FIX-2517 [D1](../FIX-2517/DECISIONS.md#d1) |
| A PDF refused on the Codex and Cursor pages | FIX-2520 [D1](../FIX-2520/DECISIONS.md#d1) |
| A line with files sent while a turn runs waits for the next turn | The epic's *what stays* |

## Decided, not asked

- **Reproduce first.** The implementation PR opens on a test that pastes an image into the Flow
  State composer, sends, and asserts the request carries it. It is red on `main` before the fix.
- **Drafts:** a session switch keeps an unsent draft's files (FIX-2518's in-memory draft); a
  reload keeps its text only, as today. The issue asked to pick one and test it; this is it.
- **No paste or drop handler stays in the app.** If one is found, it goes (ER-6).
- **Registry copies refresh, never edit.** `pnpm registry:refresh`, and the drift test proves it.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Fix the silent drop now, before the packages land, with data URLs | The workaround Kitchen Sink's rules forbid, and bytes in the request (ER-2) |

<a name="analysis"></a>
## Analysis

2026-11-08 · watermark 2026-11-05 · **Right approach.** Run over the set by `epic-agent`. Reuse:
nothing added; two call sites and a refresh. Necessity: the bug a person hits today. The set
review moved two seams this issue would otherwise have filled in the app: `useHarnessLines.send`
to FIX-2519, the user line's file parts to FIX-2518.

## How it got here

- **Drafted (Nov 8)** in the epic's spec set.

**Open: none.**
