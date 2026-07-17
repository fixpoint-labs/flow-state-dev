# Best Practices — Engine & Transport

Situational BPs for the execution runtime, option forwarding, and inbound
transport/request handling. Load this file when working in `@flow-state-dev/engine`
or on transport, routing, or authorization seams.
See [`../best-practices.md`](../best-practices.md) for the index and universal rules.

---

### BP-026: Bundle forwarded options into a `RuntimeConfig`-shaped struct, never drill

- Status: Active
- Date: 2026-05-29
- Scope: Engine — option forwarding through the execution chain.
- Rule:
  - When a field passes through 3+ layers verbatim (read at most once, never transformed), put it on a bundled struct, not a named parameter on every layer. The server chain uses `RuntimeConfig` (`packages/engine/src/runtime-config.ts`) through `createFlowApiRouter` → `createFlowRouteHandlers` → `createInboundTransportHost` → `runAction`.
  - Adding a forwarded field touches only `RuntimeConfig` plus the public boundary that constructs it. Keep the public boundary flat (the bundling is internal; `runtimeConfig` on `CreateFlowApiRouterOptions` is `@internal`).
  - Before adding a field as a named parameter on an intermediate options type, ask: "Does any layer use this, or just forward it?" Forward-only → `RuntimeConfig`. Transformed mid-chain → named parameter on the transforming layer.
- Why: Bundling forward-only options keeps the public boundary flat while a new field stays a one- to two-file change instead of a five-layer drill.

> Trust-boundary rules for the inbound seam (classify events vs actions off the trusted transport `source`, not `body.metadata`) are now universal **BP-031** — see [`../best-practices.md`](../best-practices.md).

### BP-040: Filesystem-backed persistence — symlink-safe on every segment and every op

- Status: Active
- Date: 2026-07-17
- Scope: Engine — filesystem and similar local-path store adapters.
- Rule:
  - Use `lstat` (never follow) and reject symlinks on data leaves, ancestor directories, and control/meta files (layout markers, lock files).
  - On tree walks and prefix enumeration, `lstat` every path segment you descend through — not only the scope root and the leaf.
  - Run ancestor/containment checks before any write that could create a file (including meta markers), so a symlinked subtree cannot be written through before the check runs.
  - Apply the same guard stack to every mutation entry point that touches a subtree — not only the path implemented first (see BP-035 sibling mutation paths).
  - When excluding internal publish temps from legacy scans, match an exact temp naming convention; don't use a broad prefix that legitimate user keys could share.
  - Treat symlink entries as present data when classifying legacy layout — don't skip them as "not a regular file."
- Why: Local-path stores are attacker-adjacent even in dev; symlinked intermediates, markers, and guard-order gaps are a recurring review catch when only the happy read/write path is hardened first.

### BP-041: One shared factory, one parameterized conformance matrix

- Status: Active
- Date: 2026-07-17
- Scope: Engine — store adapters and other multi-variant factories.
- Rule:
  - When one factory backs two or more exported store variants (differing only by extension, codec, or thin config), extract guard and on-disk layout tests into a parameterized conformance suite and invoke it from each variant's test file with that variant's config.
  - Don't hand-copy the matrix into one test file and leave the sibling with a stub — asymmetric coverage hides regressions in the thin wrapper path.
- Why: A fix in shared factory code only protects callers when every configured variant runs the same cases; otherwise the least-tested export rots silently.
