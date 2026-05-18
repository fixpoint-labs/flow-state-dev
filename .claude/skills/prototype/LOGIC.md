# Logic Prototype

A throwaway flow in `apps/kitchen-sink/flows/_prototypes/<name>/` that lets the user push a candidate block, pattern, capability, or state model through cases by hand. Use this when the question is about **block contracts, sequencer composition, capability shape, scope semantics, or item-emission patterns** — the kind of thing that looks reasonable on paper but only feels wrong once you run it.

The `fsdev run` NDJSON output is the state surface. There's no separate UI to build.

## When this is the right shape

- "I'm not sure if this state machine handles the case where the user re-enters the flow with stale session state."
- "Does this capability's tool wiring actually let the generator do X under condition Y?"
- "I want to feel out what the pattern factory's input config should look like before committing to it."
- "Will this sequencer composition emit the items in the order I think it will?"
- Anything where the user wants to **invoke an action by hand and watch state / items change**.

If the question is "what should this look like" — wrong branch. Use [UI.md](UI.md).

## Process

### 1. State the question

Before writing code, write down the question and the candidate shape you're prototyping. One paragraph, at the top of `apps/kitchen-sink/flows/_prototypes/<name>/README.md` (create the README; it'll get deleted with the prototype). A logic prototype that answers the wrong question is pure waste — make the question explicit so it can be checked later, whether the user is watching now or returning to it AFK.

### 2. Isolate the candidate in a portable module

The piece that's actually answering the question — the candidate block / pattern / capability — lives in its own file under the prototype directory but is written **as if** it could be imported into `packages/<pkg>/src/...` tomorrow:

- Real `defineBlock` / `defineCapability` / pattern factory.
- Real `inputSchema` / `outputSchema` (don't shortcut with `z.any()` — that defeats the point).
- No `console.log` for control flow inside the candidate. No prototype-only branches keyed on env vars. No `if (process.env.NODE_ENV === 'prototype')` shortcuts.
- BP-007 doc comments aren't required for prototypes — but BP-016 (no `z.optional` / `z.default` / `z.record` / heterogeneous `z.union` on generator outputs) **is** required if the candidate is a generator, because that's part of what the prototype is validating.

Pick whichever construct best fits the question:

- **A handler block** when the question is about a single transformation or side-effect.
- **A sequencer** when the question is about composition: how does state flow through `.then()` / `.parallel()` / `.forEach()` / `.rescue()` / `.workIf()` chains, what gets emitted at each step.
- **A generator** when the question involves model behaviour or tool invocation. Use `mockGenerator` (from `@flow-state-dev/testing`) to make the loop deterministic during prototyping; swap to a real provider only if the question is specifically about provider behaviour.
- **A capability** when the question is "what does the right `uses: [cap]` surface look like for this set of tools/context/resources?"
- **A pattern factory** when the question is "what's the right input shape for this reusable composition?"

The throwaway shell is the kitchen-sink flow that wraps the candidate. The candidate itself is the bit worth keeping.

### 3. Build a minimal flow + action that drives the candidate

In `apps/kitchen-sink/flows/_prototypes/<name>/index.ts`:

```typescript
import { defineFlow } from "@flow-state-dev/core";
import { candidate } from "./candidate";

export const prototypeFlow = defineFlow({
  kind: "_prototype_<name>",
  scopes: {
    // Whatever scopes the question requires. Keep schemas minimal.
  },
  actions: {
    run: {
      inputSchema: /* whatever shape the question needs */,
      block: candidate,
    },
    // Add more actions if the question is "what happens when I invoke
    // these in this order" — separate actions per scenario.
  },
});
```

Register the flow in kitchen-sink's flow registry (or pass `--flow-dir apps/kitchen-sink/flows/_prototypes` to `fsdev run`).

### 4. Make it runnable in one command

Add a script entry to `apps/kitchen-sink/package.json`:

```json
{
  "scripts": {
    "prototype:<name>": "pnpm --filter @flow-state-dev/cli fsdev run _prototype_<name> run --flow-dir flows/_prototypes -i"
  }
}
```

The user runs `pnpm prototype:<name> '<json-input>'` and gets the NDJSON stream on stdout, runtime logs on stderr.

For prototypes where multiple scenarios matter, provide a few example invocations in the prototype's README — copy-pasteable, one per scenario.

### 5. Watch the stream

Each `fsdev run` invocation produces NDJSON. The user reads:

- **`item_added` events** — every item emitted: `message`, `reasoning`, `block_output`, `state_change`, `error`, `step_error`. Each carries `provenance.blockName` so the user can trace which block produced what.
- **`state_change` events** — every state op, with `scope`, `resourcePath`, `changeType`. This is the answer to "did the state mutation happen in the right order, at the right step?"
- **`flow_complete` / `error`** — terminal outcome.

Pair stdout (NDJSON) with stderr (`[flow-state]` runtime logs) for the full picture. See `fsd:debug-flow` for the full event-type reference if needed; the prototype only needs whichever subset answers its question.

### 6. Iterate on the candidate

The user invokes the flow, sees something surprising in the stream, the candidate is wrong, you adjust the candidate, the user re-invokes. The TUI piece in a traditional logic prototype is replaced by repeated `fsdev run` invocations driven by the user's hand. That's slower per cycle than a keyboard-driven TUI but uses the real FSD runtime, which is the whole point — the answer is grounded in actual framework behaviour, not a simplified model.

If the user is AFK, draft 3–5 representative invocations in the README and run them yourself with `fsdev run`, recording the NDJSON output. Present the streams to the user when they return.

### 7. Capture the answer

When the prototype has done its job, the answer to the question is the only thing worth keeping. Three outcomes:

- **Adopt** — fold the candidate into the relevant package via `fsd:tdd` (the prototype gave you the behavioural target; TDD gives you the test discipline). Delete the prototype directory in the same commit. Reference the prototype in the commit message and / or BP entry.
- **Reject** — if the rejection meets the three-way filter (hard to reverse, surprising without context, real trade-off), record it in `docs/internal/out-of-scope/<concept>.md`. Delete the prototype.
- **Inconclusive** — drop a `NOTES.md` next to the prototype with what was tried and what wasn't, then either delete or hand back to the user with the question reframed.

## Anti-patterns

- **Don't add vitest specs.** A prototype that needs specs is no longer a prototype. If the question is shaped enough that you can write a spec for it, the answer is already known — move to `fsd:tdd`.
- **Don't wire it to the real Vercel AI SDK** for the first invocations. Use `mockGenerator` so the loop is deterministic; if the question is specifically about provider behaviour, switch to a real provider for the last few invocations only.
- **Don't generalise.** No "what if we wanted to support X later" in the candidate. The prototype answers one question.
- **Don't blur the candidate and the kitchen-sink shell together.** If `candidate.ts` imports anything from the prototype's flow definition, it's no longer portable. The flow shell imports the candidate; nothing flows the other direction.
- **Don't ship the kitchen-sink shell into the framework.** The shell is optimised for being driven by hand from `fsdev run`. The candidate block / pattern / capability is the bit worth keeping; the shell gets deleted.
- **Don't let `_prototypes/` accumulate.** A prototype whose question has been answered should be gone by the next merge to main. The leading underscore is a signal, not a permanent home.
