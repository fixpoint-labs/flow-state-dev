# FIX-2523 · Decisions

[Spec](SPEC.md) · **Decisions**

**No decisions of its own, in either lab.** That is the epic's collapse trigger
([D1](../../epics/FIX-2516/DECISIONS.md#d1)): this one spec covers FIX-2523 and FIX-2524.

What each lab checked for, and found already decided:

| Could have been a lab's call | Whose it is |
|---|---|
| The composer pieces, upload on attach, refusals | FIX-2518 [D1](../FIX-2518/DECISIONS.md#d1), [D2](../FIX-2518/DECISIONS.md#d2) |
| A line with files while a worker runs | The epic's *what stays*: it waits for the next turn |
| What a coding teammate or a Claude Code run gets | FIX-2519 |
| What a generator teammate's model gets from earlier turns | FIX-2517 [D1](../FIX-2517/DECISIONS.md#d1) |
| A PDF to a Codex or Cursor teammate, as its text | FIX-2520 [D1](../FIX-2520/DECISIONS.md#d1) |

## Decided, not asked

- **One implementation PR for both labs**, closing FIX-2523 and FIX-2524.
- **Styling is each lab's**: the strip takes the lab's class names; its behaviour doesn't change.
- **The Claude Code-style lab's shortcuts keep working**; its existing tests cover them, not the goal check.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Keep two issues and two specs | The trigger was set for exactly this case: identical specs are one issue |

<a name="analysis"></a>
## Analysis

2026-11-08 · watermark 2026-11-05 · **Right approach.** Run over the set by `epic-agent`. Reuse:
composed entirely from FIX-2518 and FIX-2517. Necessity: two of five chats. The finding that
mattered was the collapse itself.

## How it got here

- **Drafted (Nov 8)** in the epic's spec set as two specs; the set review found neither had a
  decision, and merged them under FIX-2523.

**Open: none.**
