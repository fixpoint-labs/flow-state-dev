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
- Why: `useMemo` is synchronous and deterministic — deriving state through `useEffect` adds a render cycle and a class of stale-intermediate-state and timing bugs.
