# Design: close the FIX-702 Agent gaps — structured output + preset-configured capabilities

**Date:** 2026-06-05
**Status:** Design, approved — ready to turn into an implementation plan.
**Type:** Framework change — `@flow-state-dev/core` (the `Agent` type) + `@flow-state-dev/workforce` (`defineAgent`, `materializeAgent`). A **FIX-702 follow-up** (Workforce: Layer 2 Abstraction).
**Relates to:** the trading-desk reorg spec `docs/internal/design/trading-desk-pipeline-reorg.md` §1/§11 (which deferred primitive adoption on exactly these two gaps), and the oversight position `docs/oversight/TRADING_DESK_LAYER2_REORG_2026-06-01.md` §6.1/§6.2 (the pressure-test findings).

---

## 1. Goal & context

FIX-702 shipped the Agent primitive (`defineAgent` / `createAgentRegistry` / `materializeAgent`), but with two gaps the trading-desk pressure-test flagged — the same two that block any **structured-output, preset-parameterized** participant from being expressed as a registry Agent:

- **Gap 1 — structured output.** `Agent` carries no `outputSchema`; `materializeAgent` hardcodes `outputSchema: z.string()` (`packages/workforce/src/materialize-agent.ts:124`). A participant that emits a typed object (a trade proposal, a portfolio decision, an analyst thesis) cannot be an Agent without losing its typed output.
- **Gap 2 — preset-configured capabilities.** `Agent.usesCapabilities` is a flat `string[]` (`packages/core/src/types/agent.ts:74`), resolved by `catalog[key]` to the *base* capability. A participant that consumes `someCapability.presets({ ... })` — cost-gated, parameterized context — cannot express that through a bare string key.

This closes both, in the framework, so the Agent primitive fits real structured work. It deliberately does **not** adopt the primitives in trading-desk — that migration (and the deferred `placeAgent` boundary + FIX-699 persona work it requires) is a separate later arc. Validating here is via workforce unit tests.

Both changes are **purely additive**: existing string-key, string-output Agents materialize exactly as before.

---

## 2. Scope

**In scope:**
- `packages/core/src/types/agent.ts` — the `Agent` type (two field changes).
- `packages/workforce/src/materialize-agent.ts` — thread the `outputSchema`; pass capability refs through `resolveCapabilities`.
- `packages/workforce/src/define-agent.ts` — accept the widened types (validation unchanged otherwise).
- `packages/workforce/test/*` — new unit tests.
- A changeset + a workforce README note.

**Out of scope (non-goals):**
- Any trading-desk change (no adoption, no `placeAgent`, no `definePersona` migration).
- Strict-schema *enforcement* in `defineAgent` (no `makeSchemaStrict` coupling — see §3.3).
- Honoring `outputSchema` for the **worker** shape (§3.2).
- `usesSkills` resolution, dynamic identities, Roles/Workstreams — all still FIX-702-out-of-scope.

---

## 3. Gap 1 — structured output

### 3.1 The `Agent.outputSchema` field

Add to the `Agent` interface (`core/types/agent.ts`, after `itemVisibility`):

```ts
  /** Structured output contract for the materialized generator. When omitted,
   *  the agent emits free text (`z.string()`). Subject to the same BP-016
   *  OpenAI-strict requirement as any generator output. Honored only for the
   *  STANDALONE shape — workers always emit `z.string()` (see materializeAgent). */
  outputSchema?: ZodTypeAny;
```

`ZodTypeAny` is already imported in core (used across the type surface); confirm the import in `agent.ts`.

### 3.2 Threading it in `materializeAgent` — the worker rule

Replace the hardcoded line (`materialize-agent.ts:124`):

```ts
// before
outputSchema: z.string(),
// after
outputSchema: !isWorker && agent.outputSchema ? agent.outputSchema : z.string(),
```

**The worker rule (the one real judgment call):** workers (`isWorker === true`) keep `z.string()` regardless of `agent.outputSchema`, because the worker output feeds the skills pattern machinery, which builds follow-on actions from **text**. Honoring a structured schema there would break that contract. Standalone materialization honors the schema; the worker shape ignores it. This is documented on the field and in the worker branch.

### 3.3 Strict-compat (BP-016) — no new enforcement

The resolved `outputSchema` is passed straight to `generator({...})` (the same call that already builds the generator). It is therefore subject to the **same** BP-016 OpenAI-strict-output requirement as every generator output — no more, no less. We add **no** `makeSchemaStrict` transform or validation in `materializeAgent` or `defineAgent` (YAGNI; it would couple `defineAgent` to the strict walker and duplicate generator's existing handling). The requirement is stated in the field doc-comment and the README; authors keep their Agent `outputSchema` strict the same way they keep generator outputs strict.

---

## 4. Gap 2 — preset-configured capabilities

### 4.1 Widen `usesCapabilities` to accept refs

Change the `Agent` field (`core/types/agent.ts:74`):

```ts
// before
  /** Capability keys this agent composes via `uses`, resolved against the capabilityCatalog. */
  usesCapabilities?: string[];
// after
  /** Capabilities this agent composes via `uses`. Each entry is EITHER a string
   *  key resolved against the materialize-time capabilityCatalog, OR a capability
   *  reference used as-is — including `someCapability.presets({ ... })`, which
   *  keeps full preset typing (mirrors how `generator({ uses })` consumes them). */
  usesCapabilities?: Array<string | DefinedCapability>;
```

A `ConfiguredCapability` (the `.presets()` result, a prototype-chained `DefinedCapability`) is structurally a `DefinedCapability`, so the union covers it. Import `DefinedCapability` from core's capability types.

### 4.2 Pass refs through `resolveCapabilities`

`materialize-agent.ts` `resolveCapabilities` (currently `~:44-62`) iterates `capKeys` and does `catalog[key]`. Extend each iteration:

```ts
for (const entry of usesCapabilities ?? []) {
  if (typeof entry === "string") {
    const cap = catalog?.[entry];
    if (!cap) { console.warn(`[workforce] agent "${agentName}": unknown capability "${entry}" — skipped`); continue; }
    out.push(cap);
  } else {
    out.push(entry); // a capability ref (base or `.presets()`-configured) — used as-is
  }
}
```

The result already flows into `generator({ uses })` (`materialize-agent.ts:132`, `...(uses.length ? { uses } : {})`), which natively consumes both base and configured capabilities (it is exactly what every trading-desk generator's `uses` already receives today). A string-keyed entry still requires the `capabilityCatalog`; a ref does not.

### 4.3 `defineAgent`

`defineAgent` validates `name`/`persona` and returns the config. It needs no new logic — only the widened `Agent` type flows through. Confirm no validation asserts `usesCapabilities` is `string[]`.

---

## 5. Testing (workforce unit tests)

All in `packages/workforce/test/`. Build small synthetic fixtures (a structured zod object; a `defineCapability` with one or two presets) — no trading-desk imports.

1. **Structured standalone output.** `defineAgent({ outputSchema: <structured object> })` → `materializeAgent(agent, { shape: "standalone", ... })` → assert the materialized generator's `outputSchema` is the structured schema (not `z.string()`).
2. **Worker rule.** The same agent materialized with `shape: "worker"` → assert output is `z.string()` (the structured schema is ignored for workers).
3. **Default (no outputSchema).** Standalone agent without `outputSchema` → `z.string()` (backward-compat).
4. **Capability ref with presets.** `defineAgent({ usesCapabilities: [cap.presets({ a: true })] })` → assert the materialized generator's `uses` carries the *configured* capability (the preset override is present), with no `capabilityCatalog` needed.
5. **Capability string key still resolves.** `usesCapabilities: ["k"]` + `capabilityCatalog: { k: cap }` → resolves to `cap` (current behavior); unknown key → warned + skipped.
6. **Mixed.** `usesCapabilities: ["k", cap.presets({...})]` → both resolve into `uses`.

Run `pnpm --filter @flow-state-dev/workforce typecheck && test`, then root `pnpm typecheck` (the type widening must not break any existing Agent usage).

---

## 6. Backward compatibility

- `usesCapabilities?: string[]` is a strict subset of `Array<string | DefinedCapability>` — every existing Agent definition still type-checks and resolves identically.
- `outputSchema` is new + optional; absent → `z.string()` exactly as today.
- Worker materialization is byte-unchanged (always `z.string()`).
- No public signature is removed or narrowed.

---

## 7. Files

| File | Change |
|------|--------|
| `packages/core/src/types/agent.ts` | add `outputSchema?: ZodTypeAny`; widen `usesCapabilities` to `Array<string \| DefinedCapability>`; imports. |
| `packages/workforce/src/materialize-agent.ts` | resolve `outputSchema` (worker rule); pass refs through `resolveCapabilities`. |
| `packages/workforce/src/define-agent.ts` | accept the widened types (confirm no `string[]` assertion). |
| `packages/workforce/test/*` | the six cases in §5. |
| `.changeset/*.md` | minor bump — additive Agent capabilities (BP-022). |
| `packages/workforce/README.md` | document `outputSchema` (+ worker rule + strict requirement) and capability refs. |

---

## 8. What this unblocks

After this, a structured-output, preset-parameterized participant (every real trading-desk synthesis agent) **can** be expressed as a registry Agent — the framework fits the work. The trading-desk adoption (the `placeAgent` boundary, the FIX-699 persona migration, the `defineAgent` + `createAgentRegistry` swap) becomes a follow-on with the foundation in place; it is explicitly not part of this change.
