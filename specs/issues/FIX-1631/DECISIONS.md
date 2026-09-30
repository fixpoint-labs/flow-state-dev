# FIX-1631 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

The FSD Architect's fence on the issue sets the scope class: docs and copy only. Never re-land a
#2350 bullet, and never change `escalate` or close FIX-1591.

<a name="d1"></a>
## D1 · Decided: ship the residue under FIX-1631

The two stale statements in `.env.local.example`, plus the two README rows that make the same
claim, ship here. The six listed gaps are recorded as closed by #2350 (`425cc4c1`).

- **Instead of:** closing FIX-1631 and filing the residue as a new issue, or rewording the six
  gaps again. The first spends a ticket and a triage on a few lines of comments. The fence
  forbids the second.
- **Why this isn't a sign-off ask:** the call costs close to nothing either way, and nothing a
  user of the app sees changes. The second look and the Architect both said so.
- **Locks in:** one docs PR that touches `.env.local.example` and the `STORE_TYPE` and
  `FSD_DB_URL` rows of the README env table. FIX-1631's description is reframed to say #2350
  closed the six gaps and the residue closes here.

## Engineering calls

- **E1 · The README rows are in scope.** README L246-247 make the same wrong claim, that a
  database URL always wins. They sit in a file this issue already names, so we fix them and keep
  the goal, rather than narrowing the goal to the example file.
- **E2 · The whole `VERCEL=1` paragraph goes, not just its middle.** Nothing on the store path
  reads `VERCEL`. The header at `packages/vercel/src/store.ts:9` says so. The only reader in
  `apps/kitchen-sink` is the bash sandbox capability
  (`flows/chat-agent/shared/capabilities/bash.ts:92`), and the paragraph isn't about that. So
  "setting `VERCEL=1` locally forces the same behaviour" is false for storage as well, and we
  decline Cursor's suggestion to keep that sentence. To try the prod profile locally, set
  `FSD_DB_URL`.
- **E3 · One owner for the selection rules.** Four places describe how the app picks a profile:
  `fsdev.config.ts`, `apps/kitchen-sink/CLAUDE.md`, the README env table and the example file.
  The example file stops restating the rules and points at the README env table. It drops the
  pool and Neon details, and no longer names the store adapter. No shared-helper refactor for
  the `FSD_DB_URL ?? DATABASE_URL` read.
- **E4 · No product bug is filed for the lingering working row.** The README already says the
  working state can outlast the answer.

## Open

None.

## How it got here

- **Draft:** framed against `main` after #2350 merged, which shrank the issue to two stale
  statements in `.env.local.example`. D1 was put up as a sign-off.
- **Round 1** (the second look, the FSD Architect, Cursor and Codex):
  - D1 is recorded as decided, not asked.
  - The README rows are in scope (E1).
  - The whole `VERCEL=1` paragraph is replaced (E2).
  - The pool and Neon details are dropped from the example file (E3).
  - The `FSD_ENV` exception is required wording.
  - Cut as out of proportion to the change: the figures, the six-row before-and-after table and
    the control check at `15087779b`.
