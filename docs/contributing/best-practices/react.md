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
  - **Partial parent re-sync:** When an effect updates parent props for one field in a multi-field config (focus re-read, cross-tab sync), audit **sibling** props too — child merge rules may treat a defined sibling as authoritative even when you only refreshed another field. Drop or omit boot-time-only siblings from the prop layer once internal state owns them, or test permutations where each injection source is present alone (see BP-035 partial multi-field external sync).
- Why: `useMemo` is synchronous and deterministic — deriving state through `useEffect` adds a render cycle and a class of stale-intermediate-state and timing bugs; partial prop updates are a common way stale boot values sneak back in after a "fixed" sync guard.
