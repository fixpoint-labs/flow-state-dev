# skills-scoped-binding › it no-cross-generator-bleed

**Issue:** FIX-911
**Outcome:** A skill bound to (or activated on) one generator never appears in another generator's context, and a runtime activation is request-scoped by default — it does not carry into the next conversation turn. Delivered by the Skills v2 per-generator binding: a shared `createSkillsLibrary` + `generator({ uses: [skills.with({ active, allowed, activeState, dynamicActivation })] })`, replacing the session-global `activeSkills` bag.
**Input:** `fixtures/input.json` — two skills (`skillA`, `skillB`), each with a `name`, `description`, and a body `marker`. Held-out: the check asserts the injected markers back out of each generator's rendered context; swapping them for any other strings still passes a correct implementation. Nothing downstream hardcodes a marker literal.
**Signal:**
- Static: generator A bound with `config({ active: [skillA] })` renders `skillA`'s marker and **not** `skillB`'s; generator B (bound to `skillB`) renders the reverse — through the real `generator({ uses: [...] })` build path.
- Dynamic: with `with({ allowed: [skillA], dynamicActivation: true })`, the assembled `runSkill` load tool writes the host generator's **own block state** (`ctx.parent`); the reader running in that generator's scope (`ctx.self`) then injects `skillA` on the next step. A different generator (its own empty block state) never sees it, and a fresh turn's fresh block-state cell renders nothing — proving request-scoped non-persistence.
**Anti-game:** A hollow pass would assert on the resolver's return value or the reader function in isolation, proving only that the function ran — not that its surface reached a block and stayed isolated. The check drives the whole `generator()` factory (resolveCapabilities → mergeCapabilities → the skills config resolver → context/tool assembly) and then **executes** the assembled reader/tool against an in-memory skills collection, grading the fixture markers. It must not assert on `buildSkillBindingReader` output directly, and must grade the markers pulled from the fixture, not constants.
**Model:** none — skill-body injection and per-generator isolation are entirely a function of config binding + block-namespaced state (FIX-914 / FIX-915), both of which complete without a generation. The only scaffolding is an in-memory skills collection and minimal block contexts; there is nothing to mock (no model), so this does not violate the goals "never a mock" rule. (A `fsdev run` with a real cheap model prompted to echo the injected marker is an optional stretch, not required — the assembled-surface assertion is the primary goal check, mirroring the FIX-915 goal.)
**Run:** `pnpm tsx goals/skills-scoped-binding/no-cross-generator-bleed/run.mts`

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-07-21 | (pre-PR) | none (build-time + assembled-surface) | PASS | Static bindings isolated (A↔B markers never crossed); dynamic block-state activation rendered on the next step, stayed off a sibling generator, and did not carry into a fresh turn. |
