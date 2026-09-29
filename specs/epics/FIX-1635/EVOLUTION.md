# FIX-1635 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only lineage that spans more than one child. Child-specific lineage belongs in FIX-1634's and
FIX-1286's own specs.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1442: every session and request carries an organization, owned by the verified principal. Source: its Linear spec document and review PR #1899 (no retained repository set) | **Retained** | Shipped (Done, 2026-09). FIX-1328's second option is this rule; the principal cluster builds on it | ER-8, ER-14 | Nothing changes for org identity |
| FIX-682: session keys and re-entry scoped by tenant. Source: `packages/engine/src/stores/scope-keys.ts` → `resolveSessionStorageKey` | **Amended** by FIX-1022 | The tenant wall holds; users inside one tenant were never separated. The key is unchanged: every path already compares the stored `userId`, so FIX-1022 changes the answer, not the key (amended in its PR, #2384) | ER-5: another user's session answers as not-found on every session route and action, refused before acknowledgement; creating a session answers `409` for a taken id, whoever holds it | Keys unchanged, so stored sessions work for their owner as before and nothing migrates |
| FIX-999: public re-entry admits an allow-list of sources. Source: `packages/engine/src/routes/public-reentry.ts` | **Retained**; FIX-1021 verifies against it | The allow-list landed after FIX-1021 was written | ER-6 | None |
| The request-as-capability model: stream attach and suspension resume are authorized by `requestId` alone, as an unguessable token, with no tenant recheck. Source: `docs/architecture/state-and-scopes.md`, "What `requestId` gates, not tenant" | **Amended** by FIX-1018 | The premise fails: a request id is caller-supplied (`routes/action-routes.ts`), `generateId` is not a CSPRNG, and ids leak in the `x-request-id` header, URLs and logs (FIX-1018's evidence) | ER-3, ER-20; FIX-1018 updates the section | A request created before FIX-1018 still attaches and resumes for its owner (BP-030) |
| FIX-1302: delivery into an existing session is refused `external-dispatcher` on a queue host. Source: `docs/architecture/inbound-transports.md`, the `external-dispatcher` paragraph | **Amended** by FIX-1634 | The refusal protected recipient concurrency and the incarnation guard; FIX-1634 restores both across the queue boundary instead of deleting it | ER-11, ER-14 | Anything still unhonourable keeps a named refusal |

Nothing is wholly superseded. Re-check each cited intent against current code before
implementing (ER-17).
