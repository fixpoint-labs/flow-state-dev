# capability-config › it resolver-reaches-generator

**Issue:** FIX-915
**Outcome:** A capability author hands a capability typed configuration via `.config({ ... })` and the resolver's output reaches the consuming block's real assembled surface, composing with presets — no bespoke `createXCapability(options)` factory.
**Input:** `fixtures/input.json` — the note string injected through `.config()`. Held-out: swapping it for any other string must still pass a correct implementation; the check asserts the injected note (and its uppercase form) back out of the assembled context, never a hardcoded literal.
**Signal:** The generator built with `banner.config({ note, loud: true })` has `note.toUpperCase()` in its assembled `config.context`; with `.config({ note })` it has `note` (the `loud` default of `false` applied); and with the `shout` preset turned on in either chain order the config reconciles to the uppercase form. All three via the real `generator({ uses: [...] })` build path.
**Anti-game:** A hollow pass would assert on the resolver's return value directly, or on `mergeCapabilities` output in isolation, proving only that the function ran — not that its surface reached a block. The check must therefore drive the whole `generator()` factory (resolveCapabilities → flatten → mergeCapabilities → resolveConfigSurface → context assembly) and read the built `gen.config.context`. It must not assert on `resolveConfigSurface` in isolation, and must grade the note pulled from the fixture, not a constant.
**Model:** none — the resolver's entire effect completes at block-build time and makes zero runtime/ctx/model changes, so there is nothing for a model to do. The assertion is on the real assembled block surface, which is why a model-in-the-loop check would add a stub without adding signal. (Per the FIX-915 spec's Testing Strategy and the spec-PR review: a merge-path assertion on the real surface is the primary goal check here; a `fsdev run` with a real cheap model prompted to echo the injected context is an optional stretch, not required.)
**Run:** `pnpm tsx goals/capability-config/resolver-reaches-generator/run.mts`

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-07-20 | (pre-PR) | none (build-time) | PASS | Assembled generator context contained the injected note (loud→uppercase, default→lowercase, shout-preset in both chain orders→uppercase). |
