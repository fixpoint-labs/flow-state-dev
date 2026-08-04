---
name: prototype
description: Build a throwaway prototype to flesh out an FSD design — either a runnable flow harness in apps/kitchen-sink for block/pattern/capability/state-machine questions, or several radically different UI variants on a single route for devtool or renderer questions. Use when the user wants to prototype, sanity-check a block shape, mock up a UI, explore design options, or says "prototype this", "let me play with it", "try a few designs".
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

## Pick a branch

Identify which question is being answered — from the user's prompt, the surrounding code, or by asking if the user is around:

- **"Does this block / pattern / capability / state shape feel right?"** → [LOGIC.md](LOGIC.md). Build a throwaway flow in `apps/kitchen-sink/flows/_prototypes/<name>/` whose action drives the candidate construct through cases that are hard to reason about on paper. Inspect the NDJSON stream from `fsdev run` to see every state change and item emitted.
- **"What should this look like?"** → [UI.md](UI.md). Generate several radically different UI variants on a single route (devtool, kitchen-sink page, or item-type renderer), switchable via a `?variant=` URL param and a floating bottom bar.

**Not this skill: a POC someone else has to see.** A prototype is *yours* — you build it to
decide, and its only durable output is the answer. When the point is instead to show reviewers
and the human at an approval gate the shape of a proposed direction, so they can sign it off or
reject it, the POC has to live where they can run it: on the never-merged spec or epic PR. That's
[`spec-poc`](../spec-poc/SKILL.md). Same throwaway rules (this file's "Rules that apply to both"
still govern the code), different home and a different reader — which is why a spec POC has to be
runnable by someone who isn't you, and a prototype doesn't.

**Not this skill either: a *contested* claim.** A prototype is exploratory and it's yours — you're undecided, and you build to learn. When the question is instead a factual claim about system behavior that a *review* is arguing over ("a router can't do that", "the store won't preserve ordering there"), the job isn't exploration, it's adjudication: a check designed so PASS and FAIL both mean something, returning a verdict with evidence. That's [`settle-claim`](../settle-claim/SKILL.md). Same throwaway rules (this file's "Rules that apply to both" still govern the code), different contract — a prototype answers *what should we do*, a settlement answers *who is right*.

The two branches produce very different artifacts — getting this wrong wastes the whole prototype. If the question is genuinely ambiguous and the user isn't reachable, default to whichever branch better matches the surrounding code: a new block / pattern / capability / scope-shape question → logic; a renderer / devtool / kitchen-sink page question → UI. State the assumption at the top of the prototype.

## Rules that apply to both

1. **Throwaway from day one, and clearly marked as such.** Locate prototypes under a `_prototypes/` directory inside the host app (`apps/kitchen-sink/flows/_prototypes/<name>/`, `apps/kitchen-sink/components/_prototypes/<name>/`, `apps/devtool/src/_prototypes/<name>/`). The leading underscore signals "not production" and keeps them out of any glob-based exports. Do not put prototypes inside the framework packages (`packages/*`) — those are shipped to consumers.
2. **One command to run.** Whatever the host app's existing task runner supports:
   - Logic prototype: `pnpm --filter @flow-state-dev/cli fsdev run <prototype-flow-kind> <action> -i '<json>' --flow-dir apps/kitchen-sink/flows/_prototypes` — wire a one-line helper script in the host app's `package.json` if the invocation is awkward.
   - UI prototype: `pnpm --filter @flow-state-dev/kitchen-sink dev` or `pnpm --filter @flow-state-dev/devtool dev` (whichever app hosts the variants).
   The user must be able to start it without thinking.
3. **No persistence by default.** Use the in-memory store. Seed state via `--seed-session` / `--seed-user` / `--seed-project` if the question depends on starting state. Reach for `@flow-state-dev/store-sqlite` only when the question is specifically about persistence semantics — and label the database file `PROTOTYPE-wipe-me.sqlite`.
4. **Skip the polish.** No vitest specs, no error handling beyond what makes the prototype runnable, no abstractions. Prototypes that grow specs aren't prototypes any more — they're code, and they need to go through `tdd` instead.
5. **Surface the state.** For logic: every `fsdev run` invocation produces NDJSON on stdout — that *is* the state surface. Don't pretty-print or filter; let the user read the full stream. For UI: render the full relevant state inside the variant (real data shape, real cardinality), or print it in a debug panel during prototyping.
6. **Keep the candidate module portable.** The piece that's actually answering the question — the candidate block, pattern, capability, or state model — should be importable from somewhere that could one day become a real package location. The kitchen-sink flow / variant component is the throwaway shell; the underlying construct is the bit worth keeping if the answer is "yes, ship it."
7. **Delete or absorb when done.** When the prototype has answered its question, either delete it or fold the validated decision into the real code. Don't leave it under `_prototypes/` rotting; that directory must stay genuinely temporary.

## When done

The **answer** is the only thing worth keeping from a prototype. Capture it somewhere durable along with the question it was answering:

- **Question survives, answer adopted** → fold the candidate into the relevant package (`packages/core/`, `packages/patterns/`, `packages/tools/`, etc.) and write the regression tests via `tdd`. Note the prototype in the commit message: *"Distilled from `apps/kitchen-sink/flows/_prototypes/<name>` — see commit X."*
- **Question survives, answer rejected** → record in `docs/internal/out-of-scope/<concept>.md` if the rejection meets the three-way filter (hard to reverse, surprising without context, real trade-off). See `improve-codebase-architecture`'s SKILL.md for the filter.
- **Question shifted mid-prototype** → leave a short `NOTES.md` next to the prototype before deleting, with the original question and what was learned. The user (or a future agent) can decide whether the new question needs its own prototype.

Don't leave the prototype directory populated. It rots fast and confuses the next reader; the framework's architecture docs and BPs are durable, half-finished prototypes are not.
