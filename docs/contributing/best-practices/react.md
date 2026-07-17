# Best Practices — React

Situational BPs for React hooks and components in `@flow-state-dev/react`, the
devtool, and UI packages. Load this file when writing or editing React code.
See [`../best-practices.md`](../best-practices.md) for the index and universal rules.

---

### BP-010: React component conventions

- Status: Active
- Date: 2026-03-10
- Scope: React — `@flow-state-dev/react`, devtool, UI components.
- Rule:
  - **Prefer `useMemo` over `useEffect` for derived state.** If a value can be computed from props or other state, derive it with `useMemo`. Reserve `useEffect` for genuine side effects: subscriptions, DOM manipulation, data fetching, external-system sync.
  - **Comment every `useEffect`** with what side effect it performs and why it exists.
  - **Comment non-obvious logic** — complex conditions, non-trivial memo dependencies, workarounds.
  - Derive flags (`isStreaming`, `canResume`, button-enabled) from the *complete* input set (including `enabled` / per-action handlers / resolved state); fire change-signals only on a *real* change, not no-op patches or filtered items (see BP-035).
  - **Prop-to-state sync in providers:** when a `useEffect` mirrors external props into context/reducer state, treat the prop snapshot as the unit of change.
    - Staleness guards and effect deps must cover **every field the prop supplies** — adding a field to the synced shape (e.g. `bearerToken` beside `userId`) requires updating the guard, not only the field that existed before.
    - Detect external changes with a ref of the last-applied prop/`baseUrl` snapshot; **do not** list internal provider state (e.g. `state.config`) in that effect's deps — internal `setConfig` edits must not re-run external sync and revert operator overrides.
    - When props are a **partial view** (a field is `undefined` because it is not persisted on the prop layer), **merge** into state instead of wholesale replace so runtime-only fields (ad-hoc Settings credentials) are not dropped on focus re-read or identity-only prop updates.
- Why: `useMemo` is synchronous and deterministic — deriving state through `useEffect` adds a render cycle and a class of stale-intermediate-state and timing bugs; prop-sync effects that compare an incomplete shape or conflate internal edits with external updates produce latent stale clients and self-reverting Settings.
