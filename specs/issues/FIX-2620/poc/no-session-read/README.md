# POC · a user-scoped view answers with no session

Retained design evidence for [FIX-2620](../../SPEC.md). Throwaway code, outside every default
build, test, lint and fallow run: nothing under `specs/` is in a package's vitest `include` or
`tsc` roots, ESLint ignores `specs/**/poc/**`, and fallow ignores `specs/**`. Nothing here is
imported by a package.

```bash
bash specs/issues/FIX-2620/poc/no-session-read/run.sh                        # both cases, green
POC_STRICT_CONTROL=1 bash specs/issues/FIX-2620/poc/no-session-read/run.sh   # the control, red
POC_STACK=1 bash specs/issues/FIX-2620/poc/no-session-read/run.sh            # print any throw's stack
```

`run.sh` applies `no-session.patch` to `packages/engine/src`, copies the test into
`packages/engine/test/`, runs it, and undoes both on exit. The patch is the change the verdict
prices, so it is kept as a diff rather than as code anything could import.

## The question

Can a view at user or org scope run its block with **no session at all** (only `userId` and
`orgId`), read the user's and the org's resources, and still refuse every write? A throwaway
session does not count ([D1](../../DECISIONS.md#d1)): `createExecutionContext` already makes an
ephemeral session id when none is passed.

## What it runs

A flow with a user-scoped `pins/*` collection and an org-scoped `org-notes/*` collection. A
`seed` action writes two pins and one org note in a real session (`sess_seed`). Then one read
block, `pins-view`, lists both collections, tries to create a third pin, and touches
`ctx.session.identity`, reporting each outcome. The test measures four signals from the
block's output **and from the stores after the run**:

| Signal | Pass means |
|---|---|
| reads user and org | both pins and the org note come back |
| write refused | the create throws `read_only` |
| session refused | `ctx.session` throws `NoSessionError`, not a session |
| no session record | the session store lists exactly what it listed before, and the run did not throw |

The POC path also wraps the session store in a call recorder: it must not be called **at all**,
which is stronger than "nothing stored" and is what rules out a session made and dropped.

**The control** is today's `runRead` with no session id. It must fail the *no session record*
signal for the right reason: the test requires that it either stored a session or was refused
inside session birth (`ensureSessionRecord`), and it checks the stack, because an early version
of this control "failed" on a wrong import and proved nothing.

## What it showed · 2026-11-10, on `main` at `21aef7b4`

**Verdict: CONFIRMED, past a small change.**

- **Control (today's `runRead`, no session id): FAIL, as it must.** It never reached the block.
  It made the ephemeral id, went into session birth, and the read-only stores refused birth's
  first write (`purgeTombstones` on the new session's resource state) with `read_only`. All four
  signals false; `threwInSessionBirth: true`.
- **POC (`runView`, `userId` + `orgId`, `noSession: true`): PASS.** Pins `["first pin",
  "second pin"]`, org note `["org note"]`, write refused `read_only`, `ctx.session` refused
  `NoSessionError`, session store unchanged (`["sess_seed"]`) and **never called**.
- **The change it took:** 61 lines added, 11 removed, in four engine files
  (`no-session.patch`). With it applied, `pnpm typecheck` in `packages/engine` is clean and the
  full engine suite passes (4567 tests; one unrelated flaky failure on the first run, clean on
  the rerun), so the opt-in mode leaves the session path alone.

### What the change is (FIX-2623's first piece of work)

1. **`createExecutionContext` gets a no-session mode.** It skips the session load, session birth,
   the session binding checks and the history window; takes the org from the run's own validated
   `orgId` (the instance pin still runs); installs no session-scoped resources; and stands a
   refusing record and a refusing `ctx.session` where the session was. Nothing touched the
   refusing record during the run, so the rest of the 4800-line context does not reach for the
   session on a view's path.
2. **Execution metadata stops reading `ctx.session.identity.id`.** `createExecutionMetadata`
   did, on every block, and was the one place the run broke. Its `sessionId` is already
   optional; the POC returns none in a view.
3. **`runRead`'s read-only store wrappers are reused as they are** (the patch only exports
   `readOnlyStores`).

### What it did not cover

- **Generators.** The default generator history (`ctx.session.items.history()`), `contextFn`'s
  `ctx.session.state`, and `history-summary` reach for the session. A generator in a user-scope
  view would meet `NoSessionError`. FIX-2623 says whether a view may hold a generator, and if so
  turns history off for it.
- **The request's own record still carries a session id string.** The ephemeral id is still
  computed and used as a label (logging, the in-memory request record that is dropped with the
  read). No session record exists under it anywhere, and the session store is never called, but
  FIX-2623 should make the field absent rather than invented.
- **Request end.** `runView` does not drain side chains or run request-end hooks as `runRead`
  does; nothing in the view used them.
- **A user with no user record yet.** The user record existed from the seed action. `runRead`'s
  scratch seeding should cover a first-ever view, but this run did not exercise it.
- **The route, the verified principal and the client call.** FIX-2623 and FIX-2624's.
