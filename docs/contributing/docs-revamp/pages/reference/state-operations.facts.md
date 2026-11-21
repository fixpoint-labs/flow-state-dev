# Fact sheet: State operations (R-07, reference, `reference/state-operations`)

Pass 1. Cites only: the existing pages (`apps/docs/docs/fundamentals/state-operations.md` = `ops`, `apps/docs/docs/state/mutation-model.md` = `mm`, `apps/docs/docs/fundamentals/state-and-scopes.md` = `sas`, `apps/docs/docs/advanced/block-state.md`), exported surface and doc comments, tests, `goals/`, one example. No spec was read. Paths are from the repo root.

Abbreviations:

| Abbr | File |
|---|---|
| `st` | `packages/core/src/types/state.ts` (the exported `ScopeStateOps`, `CASOptions`) |
| `sc` | `packages/core/src/types/scope.ts` (`RequestScopeHandle`, `SessionScopeHandle`, `UserScopeHandle`, `OrgScopeHandle`) |
| `blk` | `packages/core/src/types/block.ts` (`BlockContext`, `StateRef`) |
| `flw` | `packages/core/src/types/flow.ts` (`SessionConfig`, `UserConfig`, `OrgConfig`, `RequestConfig`) |
| `de` | `packages/contracts/src/helpers/deep-equal.ts` (re-exported as `@flow-state-dev/core/helpers`'s `deepEqual`, `packages/core/src/helpers/deep-equal.ts`) |
| `smerge` | `packages/core/src/helpers/scope-state-merge.ts` |
| `usw` | `packages/core/src/helpers/update-state-with.ts` |
| `sco` | `packages/engine/src/stores/state-container.ts` [impl] |
| `cas` | `packages/engine/src/stores/cas.ts` [impl] |
| `sp` | `packages/engine/src/stores/scope-persist.ts` [impl] |
| `fe` | `packages/engine/src/errors/flow-error.ts` |
| `lock` | `packages/engine/src/stores/scope-lock.ts` |
| `emit` | `packages/engine/src/context/scope-emit.ts` [impl] |
| `cec` | `packages/engine/src/context/createExecutionContext.ts` [impl] |
| `sb` | `packages/engine/src/context/session-birth.ts` [impl] |
| `item` | `packages/contracts/src/items/types.ts` (`StateChangeItem`) |
| `t/…` | `packages/engine/test/…` unless a package is named |

**[impl]** marks a behaviour I could confirm only in engine source, a doc comment on engine source, or a run in this pass. Pass 5 should check each against a test or a run before the page states it. **[ran]** marks something I observed by running a throwaway test against `createExecutionContext` with the in-memory stores in this pass (section 15); the probe files were deleted. **[test]** means an existing test pins it.

## 0. What the page is, and the four questions

The page is a Reference page: tables and signatures, no narrative. From the sitemap: one table of every operation (takes, returns, when a write is a no-op), the equality rules, concurrent writes. Lookups: "What does a patch return when nothing changed?" and "Two blocks write one field in parallel: which wins?".

Every scope exposes the same seven operations. They live on the four scope handles, `ctx.request`, `ctx.session`, `ctx.user` and `ctx.org`, and on the block-level handles `ctx.sequencer`, `ctx.self`, `ctx.parent` and target refs. `st:34-48` (`ScopeStateOps`), `sc:219-255`, `sc:326-338` (each handle type is `{ identity, state } & ScopeStateOps<TState>`), `blk:201-217` (`StateRef` picks the seven by name), `blk:355-356`, `blk:370`, `blk:427-431`.

The page is about the operations, not the stored records, but the four questions apply to what they write:

| Stored part | Who owns it | Who can see it | Where stored | How many |
|---|---|---|---|---|
| Request state | The one request. | Blocks running in that request. No `client` config exists for it (`flw` `RequestConfig` has no `client`), so the browser never sees it. | On the request record, written on every mutation. `cec:2639-2653` (request ops persist to the request store). | One per request. |
| Session state | The session (one user in one organization). | Blocks in any request of that session. The browser sees only fields the flow exposes. | On the session record. `cec:2696-2713`. | One per session. |
| User state | The user inside one organization. | Blocks in any session of that user in that org. | On the user record keyed by user and organization (`t/context.test.ts:90`, key `user_1:~org:<orgId>`). | One per (user, org). |
| Org state | The organization. | Blocks in any session of any user in that org. | On the org record keyed by the org id. `t/scope-state-noop-stale-read.test.ts:91` (`stores.org.get(DEFAULT_ORG_ID)`). | One per org. |
| Sequencer, `ctx.self`, parent and target state | One execution of one block instance, within the request. | The block that owns it, and (by `ctx.parent` / targets) the blocks the owner exposes it to. | Held in memory during the run; not a scope record. A sequencer's non-transient fields are written into its durable checkpoint and restored on resume (`apps/docs/docs/advanced/sequencer-state.md:123-125`, `:164`); `transientSlot()` fields and a handler's `ctx.self` are not checkpointed. | One per block instance per request. |

The state-and-scopes page owns "which scope for what". This page owns what a write does. Resource state has its own mutators and its own rules; see section 14 (carried to R-08).

## 1. The seven operations (the table)

All signatures: `st:34-48`. Every one returns `Promise<boolean>`. Each is read from the same file as the source unless a test is named.

| Operation | Takes | Does | Notes |
|---|---|---|---|
| `patchState(updates)` | `Partial<TState>` | Merges the named top-level fields into state. Other fields are untouched. `sco:358-365` (`{ ...state, ...updates }`). | Shallow: a nested object you name replaces the stored one. `sco:361-364`. [ran: a two-field patch kept an unnamed `b`] |
| `patchState(key, updater)` | a key of `TState` and `(current) => next` | Calls `updater` with that field's current value and stores the result under that key. `sco:367-374`. | Read-modify-write on one field. Version-checked (section 6). |
| `setState(next)` | the whole `TState` | Replaces the state with `next`. A field not in `next` is dropped. `sco:380-382`; [ran: after `setState({ mode: "set" })`, state was exactly `{ mode: "set" }`]. | the `ops` page (`setState` section) also says a schema default for a dropped field is restored "on the next read". Stored default filling is on the state-and-scopes sheet (`t/scope-state-defaults.test.ts:93-102`). |
| `incState(increments)` | `Record<string, number>` | Adds each value to the field's current number. Negative values subtract. A field that is absent or `null` starts from 0. `sco:384-424`; `t/inc-state-wrong-type.test.ts:34-52`. | Typed `Record<string, number>`: the type does not check the field is numeric in `TState`. |
| `pushState(field, value)` | a field name and one value | Appends `value` to the array in `field`. An absent field becomes `[value]`. `sco:426-456`; `t/push-state-wrong-type.test.ts:47-63`. | One value per call; there is no spread form. |
| `setStateRecord(field, key, value)` | a field name, a key, a value | Sets `state[field][key] = value`, leaving the other keys of that map alone. If the field is not an object, the map starts empty. `sco:458-484` (`toRecord`, `sco:42-48`). | |
| `deleteStateRecord(field, key)` | a field name and a key | Removes that key from the map in `field`. Other keys are untouched. `sco:486-510`. | On an absent field it still writes `{}` there and returns `true`. [ran: after a `setState` that dropped `byId`, `deleteStateRecord("byId","nope")` returned `true`]. On a map that exists and lacks the key it is a no-op, `false` (`t/state-container.test.ts:155`). |
| `atomicState(mutator)` | `(state: Readonly<TState>) => Partial<TState>` | Calls `mutator` with the current state and merges the returned partial in, top level, like `patchState`. `sco:512-527`. | The mutator is typed to return synchronously (`st:47`) and the implementation does not await it (`sco:519-523`). It cannot remove a field (the merge only adds or replaces). |

### What each takes and what throws

- `incState` throws a plain `Error` when a named field holds anything other than a number, `null` or nothing. The message is `incState target "<field>" is not a number (got <string|array|object|...>)`. The stored value is unchanged and, for a multi-field call, none of the increments apply. `sco:406-414`; `t/inc-state-wrong-type.test.ts:22-32`, `:55-71` (whole call refused, nothing persisted), `:89-111` (a store-side string the local copy has not seen also refuses). [test]
- `pushState` throws a plain `Error` when the field is present and is not an array, `null` included: `pushState target "<field>" is not an array (got null|string|...)`. Unchanged value. An inherited name such as `toString` is not a stored field and starts a new array. `sco:441-451`; `t/push-state-wrong-type.test.ts:14-45`. [test]
- Neither error has a class. Only the message names the field. `ops:56`, `ops:68`; confirmed `sco:411`, `:447`.
- `patchState` and `setState` do not check the value against the scope's schema: a `patchState` of a wrong-typed value is a TypeScript error, not a runtime refusal. [verify: not pinned by a test I read; keep to the type signature].
- A write on a session whose flow declares a top-level `.readonly()` session field is refused when it would change that field. See section 11.

## 2. What a write returns (the return-value rules)

Doc comment: "`true` when the write produced a real state change and `false` when the proposed update was structurally equal to the current state." `st:26-33`. The comment is a simplification (see the three cases below), so the page should state the rules, not quote it.

| Return | Means |
|---|---|
| `true` | The write was sent to the store (or committed, on a scope with no store), the version advanced by one, and a `state_change` item was emitted, except when the response has no item emitter or the changed fields are all transient keys of block state (the wrapper returns `true` before emitting; `atomicState` likewise). `scope-emit.ts:41-46, 156-157, 176-240`. `sco:196-198`, `emit` (every wrapper returns `false` before emitting if the base op did). |
| `false` | Nothing was written. No version bump. No `state_change`. `emit:159`, `:201`, `:212`, `:221`, `:229`, `:241`, `:256` (each `if (!committed) return false`). |

`false` has four causes:

1. **A no-op.** The proposed state equals the current state (equality: section 3). On a version-checked write the skip happens only after the store confirms the version this context read is still current (section 4). `cas:182-195`; `t/state-container.test.ts:124-175` (nine different calls, all `false`, persist never called, version unchanged); `t/state-container-lock.test.ts:58` (no store). [test]
2. **The scope's record no longer exists, for single-operation writes only.** `incState`, `pushState`, one-field `patchState`, `setStateRecord` and `deleteStateRecord` on a deleted session, user or org record return `false` and do not recreate it (the store verb reports a conflict with no current value; `runCommutative` returns `false`). `setState`, `atomicState`, `patchState(key, updater)` and multi-field `patchState`/`incState` go through `runWithCAS`: a set against a missing record conflicts at version 0, the retry's set at `expectedVersion` 0 is admitted (an absent record reads as version 0) and the record is recreated, or `ConcurrentModificationError` is thrown when retries run out. `cas.ts:176-217`, `scope-write-predicate.ts:74-77`, `state-container.ts:263-292`. [ran: `incState` after deletion returned `false`]. the `ops` page ("A write is also refused") says "every store checks that the record exists before it looks at any version".
3. **A write with no version fell back to a full-record write and lost.** See section 7.
4. A write with no version is compared against this context's own copy, not the store (section 4).

`true` does not promise the stored value changed (`ops:154`, [ran], see section 4).

## 3. Equality rules (what counts as "nothing changed")

Source `de:10-16` (doc comment: "the framework's state-write no-op guard"), `de:36-64`, `de:66-80`.

| Rule | Detail | Source |
|---|---|---|
| Primitives | Compared with `Object.is`: `NaN` equals `NaN`, `+0` does not equal `-0`. | `de:11`; [ran: second `patchState({ nn: NaN })` returned `false`; `0` then `-0` returned `true`] |
| Plain objects | Same set of own keys and equal values, recursively. A key holding `undefined` is a different object from a missing key (own-key-set equality). | `de:12` |
| Arrays | Same length and equal elements in order. | `de:13` |
| `Date` | Compared by `getTime()`. | `de:14` |
| `null` vs `undefined` | Distinct. | `de:15` |
| Depth | Past 32 levels, the comparison throws `RangeError`. | `de:16`, `de:67-71` |
| Not JSON-shaped | A function, symbol, `Map`, `Set`, `RegExp`, typed array or class instance in state makes the comparison throw `TypeError` (`deepEqual: <a|b> contains a <kind>; state must be JSON-shaped.`) unless the two sides are the identical value. | `de:36-64`, `de:73` |
| Empty calls | `patchState({})`, `incState({})`, `incState({ n: 0 })`, `atomicState(() => ({}))` return `false`. | [ran]; `t/state-container.test.ts:154-159` |

- `patchState("key", (c) => c)` (an updater that returns what it was given) is a no-op, `false`. `t/state-container.test.ts:154`. [test]
- `setState` with a value equal to current state is a no-op. `t/state-container.test.ts:155`; [ran: `setState({ ...state })` returned `false`].
- Equality is evaluated on the whole next state against the whole current state, not field by field. `sco:194`, `:275`.

## 4. The no-op check reads a cache for some writes and the store for others

This is the reason `true` and `false` do not describe the stored value (the `ops` "What a write tells you" section). Each row below is the observable rule.

- **Each context reads state once, and its writes keep that copy fresh.** `ctx.<scope>.state` is a typed read of this execution context's copy of the record. It reflects this context's own writes immediately. [ran: after `incState` in context B, `B.session.state.n` read the store's total, 2, because the store's merged record is what the context adopts after a delta write]; `sco:306-316` (a delta write adopts the store-returned record when its version is newer); `ops:112`. It does not see another context's writes until the next write on this one refreshes it.
- **Version-checked writes** (`setState`, `atomicState`, `patchState(key, updater)`, `patchState` with two or more fields or none, `incState` with two or more fields or none): a result equal to this context's copy is a no-op only if a re-read confirms the stored version is the one this context holds. If another context has written since, the write is sent and lands, and returns `true`. `cas:182-195`; `t/scope-state-noop-stale-read.test.ts:97-114` ("lands a deliberate write that only equals this context's stale copy"), `:116-128` (genuine no-op still `false`, no write, no version bump), for session, user and org. [test]
- **Writes with no version** (`patchState({ f: v })` one field, a plain value; `incState({ f: n })` one field; `pushState`; `setStateRecord`; `deleteStateRecord`): the no-op check runs against this context's own copy and is not verified against the store. If the write equals the stale copy it is skipped, returns `false`, and the other context's value stays stored. `sco:266-277` (`runCommutative`: `deepEqual(current, nextState)` returns `false` before any persist). [ran: context C read `mode: "chat"`, context D stored `"agent"`, C's `patchState({ mode: "chat" })` returned `false`, store still held `"agent"`]. No test pins this; pass 5 should run it again or keep it to a one-line row.
- A skipped no-op does not refresh the context's cached copy, so reading `ctx.<scope>.state` after a `false` returns the same copy the decision used. `sco:297-303`, `ops:202`.
- A write that is not a no-op and succeeds returns `true` even when the stored value ends up unchanged (for example `setStateRecord` of a value another context already stored, when this context's copy differed). `ops:154`.

## 5. Which writes carry a version (the one split that decides the rest)

From `sco:338-346` (patch), `:390-394` (inc), `:427-431` (push), `:463-467` (setStateRecord), `:490-493` (delete), `:525` (atomic), `:381` (set); `cas:63-74` (`isCommutativeHint`); `t/scope-persist-routing.test.ts:127-337` (every row below pinned). [test]

| Call | Version-checked | Handed to the store as one operation, no version |
|---|---|---|
| `setState(next)` | yes | |
| `atomicState(mutator)` | yes | |
| `patchState(key, updater)` | yes | |
| `patchState({ a, b })`, two or more fields (or `{}`) | yes | |
| `patchState({ f: value })`, one field, value not a function | | yes |
| `patchState({ f: fn })`, one field whose value is a function | yes | |
| `incState({ f: n })`, one field | | yes |
| `incState({ a: 1, b: 1 })`, two or more fields | yes | |
| `pushState(field, value)` | | yes |
| `setStateRecord(field, key, value)` | | yes |
| `deleteStateRecord(field, key)` | | yes |

(`t/scope-persist-routing.test.ts:129-179` for patch, `:191-215` for inc, `:217-259` for push/record/delete, `:261-272` atomic.)

A row in the right column carries no version only when the store behind the scope offers the matching operation (section 7). Otherwise it is written as a whole record at the version this context holds, once, no retry. `sp:187-207` (the fallback), `t/scope-persist-routing.test.ts:339-370` ("falls back to set when the adapter does not advertise ..."). [test]

Scopes with no store (sequencer, `ctx.self`, parent and target state) have no version at all (section 9).

## 6. Concurrent writes: what two writers end up with

Same-field behaviour per call. "Both" means both writers' effects are present. [ran] marks rows I ran through two execution contexts sharing one in-memory store.

| Call | Two writers, same field |
|---|---|
| `incState({ f: n })`, one field | Both land. The store adds both deltas. [ran: two `incState({ n: 1 })` from two contexts gave `n: 2`, both returned `true`.] [ran: the same on a field that read as its schema default and was not yet stored.] |
| `pushState(f, v)` | Both land, in the order the store applied them. Position is not promised. [ran: `["a","b"]`.] `ops:263`. |
| `patchState({ f: v })`, one field | Last write wins. The first value is gone. Both calls return `true`. [ran: owner `"A"` then `"B"` stored `"B"`.] |
| `setStateRecord(f, k, v)` | Last write wins on that key. Other keys of the map are untouched. `ops:238` (not run). |
| `deleteStateRecord(f, k)` | The key is removed; other keys untouched. `ops` concurrent-writes table (`deleteStateRecord` row). |
| `setState(next)` | `next` is written as it stands. Another writer's fields not in `next` are replaced. After a lost version race it is re-sent unchanged, not recomputed. [ran: a context that held a stale copy wrote `setState({ visits: 0 })`, returned `true`, and the other writer's `jfield` was gone.] |
| `patchState({ a, b })`, two or more fields | The fields you name overwrite theirs; the fields you did not name survive, even ones the other writer changed. On a lost race the fixed values are re-applied to the refreshed state. [ran: stale writer's `{ a: 7, mode: "e" }` over another writer's `{ a: 5, b: 5 }` left `a: 7, b: 5, mode: "e"`.] |
| `incState({ a, b })`, two or more fields | Both sets of increments land: the computation re-runs against the winner's value. the `ops` concurrent-writes table (`incState` two-field row). |
| `patchState(key, updater)` | The updater runs again against the value that won. [ran: a claim `patchState("owner", c => c ?? "worker-b")` after another context stored `"worker-a"` returned `false` and left `"worker-a"` (the updater re-ran, returned the same value, a no-op).] |
| `atomicState(mutator)` | The mutator runs again against the value that won. [ran: the mutator ran twice after another context added 10; the stored total was both changes.] |

Facts behind the table:

- A version-checked write that loses re-reads the record, calls the mutator again with the refreshed state and tries again. `cas:164-222`. The mutator can run more than once: it should be a pure function of the state it receives and write nothing declared outside it. `mm:218-264` (the updater section), `cas:1-4`, `usw:1-17`. [test: `t/state-container.test.ts:22-60`, retry on conflict].
- Single-field `incState` and `pushState` on a field the scope reads as its schema default (not yet stored) are written as a version-checked whole-record write, re-applied up to 4 attempts, because the store's native add would drop the default. After 4 lost attempts the call returns `false`. `sp:68-78`, `sp:100-146` (`MAX_ADDITIVE_ATTEMPTS = 4`). [impl; the 4-attempt loop is not pinned by a test I found; [ran] only the two-writer success case.] The page may say "both land" and leave the budget to Reference prose; pass 5 should decide whether to keep the attempt count.
- The version-checked write retries up to `cas.maxRetries` times, default 3, after the first attempt, with a wait of `baseDelayMs × 2^(attempt-1)` between tries, `baseDelayMs` default 10 (10, 20, 40 ms). `cas:31-32`, `:129-148`. `maxRetries` is floored at 0. `cas:129-131`.
- Configured per scope as `cas: { maxRetries?, baseDelayMs? }` on the flow's `session`, `user` and `org` config. `flw:369`, `:482`, `:489`; `st:1-4`; `cec:2655`, `:2697`, `:2739`. **Request scope has no `cas` option** (`RequestConfig` has none; `cec:2639` passes none; `t/state-container-lock.test.ts:545-548` comment).
- When retries run out the call throws `ConcurrentModificationError`: `code` `"concurrent_modification"`, `retryable` `true`, `attempts` (= retries + 1), `details.attempts`, message `State update failed due to concurrent modifications`. `fe:355-373`; `cas:218-221`; exported from `@flow-state-dev/engine`, `engine/src/index.ts:16`. [ran: with `maxRetries: 0` a stale `atomicState` threw `ConcurrentModificationError` with `code: "concurrent_modification"`, `retryable: true`, `attempts: 1`.] [test: `t/state-container.test.ts:62-78`].
- **Conflict with `ops`:** `ops:350` documents `err.code` as `"CONCURRENT_MODIFICATION"`. The code says `"concurrent_modification"`. The code wins. The same page's `reference/errors` sheet already has the lowercase (`reference/errors.facts.md:223`).
- Writes with no version never raise `ConcurrentModificationError` (nothing to conflict with). `ops:221`; `sco:155-160`.
- A fan-out wider than the retry budget on session scope does raise: `t/state-container-lock.test.ts:542-593` ("session scope stays on CAS and still surfaces `ConcurrentModificationError`", with `session.cas` pinned to 2 retries). Request scope commits the same fan-out, `t/state-container-lock.test.ts:402-460`. [test]
- `deleteStateRecord`, `patchState` single-field and the others in the right column land against whatever the store holds at that moment, so two writers on different fields, or on different keys of one map, both survive. `ops` "Last write wins" section (`ops:269`); `t/store-delta-verbs.test.ts:235-256` ("isolation between fields"). [test]

### Last-write-wins lookup (the sitemap's second lookup)

- **Two blocks write one field in parallel: which wins?** Depends on the call. Single-field `patchState` and `setStateRecord` on one key: the write that reaches the store second wins; both return `true` and nothing is raised. `incState` and `pushState`: neither is lost. `setState`: wholly replaces the other's fields. `atomicState` and the updater form of `patchState`: the later one re-runs on the winner's value and combines.
- Two blocks in parallel within one request share one container, so on request scope their writes run in submission order, one version bump each. See section 9.

## 7. The store has to offer the operation

A write with no version uses a native store operation (`patchField`, `incField`, `pushToArray`, `deleteField`) only if the store defines it. `sp:166-207`, `engine/src/stores/types.ts:750` (`deleteField?` is optional, as are the others on `DeltaStoreOps`).

| Store | Offers the four verbs on |
|---|---|
| In-memory | session, user, org: all four. Request: `patchField`, `incField`, `pushToArray`; no `deleteField`. `engine/src/stores/memory/session-store.ts:41-77`, `user-store.ts:34-70`, `org-store.ts:34-70`, `request-store.ts:106-133`. |
| Filesystem | session, user, org, request: `patchField`, `incField`, `pushToArray` only. No `deleteField` on any. `engine/src/stores/filesystem/session-store.ts:96-123`, `user-store.ts:44-71`, `org-store.ts:57-84`, `request-store.ts:384-411`. |
| SQLite | session, user, org: all four (`store-sqlite/src/sqlite-store.ts:70-98`, `:389-460`). Request: `patchField`, `incField`, `pushToArray` (`store-sqlite/src/request-store.ts:592-594`). |
| Postgres | session, user, org: all four (`store-postgres/src/pg-store.ts:124-150`, `:550-650`). Request: three (`store-postgres/src/request-store.ts:519-521`). |

(Conformance suite: `engine/src/stores/testing/scope-store-conformance.ts`. Tests: `t/store-delta-verbs.test.ts`, `t/stores/filesystem/delta-verbs.test.ts`, `store-sqlite/test/delta-verbs.test.ts`, `store-postgres/test/delta-verbs.test.ts`.)

Consequence for `deleteStateRecord`: on request state (every store) and on any scope in the filesystem store, it writes the whole record at the version this context holds, in one attempt. If another writer moved the record first it returns `false` and the key is still stored. `sco:285-303`, `sp:187-207`. The cache is not refreshed, so repeating the call in the same context sends the same lost version and returns `false` again. `sco:297-303`. The fixes: use `atomicState` (re-runs on conflict), or a fresh execution context. `ops:308-340` (code example, unchanged). Pass 5: no test pins the filesystem case; the comment at `sco:290-296` records a measurement ("a store with no delta verbs holding version 7 against a container at version 0 refused three `deleteStateRecord` calls in a row"). Keep the row, mark pass 5 to run it.

`incState`, `pushState` and single-field `patchState`/`setStateRecord` have a native verb on every built-in store, so they never take this fallback there.

## 8. Reading state

- `ctx.<scope>.state` is a typed read, `Readonly<TState>`, inferred from the scope's Zod schema. `sc:226-250` (`state: Readonly<TState>` on each handle), `blk:338-356`.
- **It is a type, not a guard.** Assigning to a property of `ctx.session.state` does not throw and does not freeze; it changes this context's copy and is never stored. [ran: `Object.isFrozen(ctx.session.state)` false; `ctx.session.state.n = 5` did not throw, a later read gave 5, the stored record still held 1.] State changes only through the seven operations. This is the observable half of the state-and-scopes row "state is read-only on ctx".
- A write is reflected in the next read of `ctx.<scope>.state` in the same context. [ran]. `ops:112`.
- A scope with nothing stored reads its schema defaults. [ran: a fresh session whose flow's block declared `visits: z.number().default(0)` read `{ visits: 0 }` while the stored record was `{}`.] Details on state-and-scopes.
- `ctx.<scope>.identity`: `{ type, id, userId?, orgId? }` (`ScopeIdentity`). `ctx.request.incarnation`. `sc:215-232`, `ops:121-125`. Those are Reference rows on the blocks page; they stay on `reference/blocks` unless the page plan says otherwise. [ref: out of scope here]

## 9. Write paths by scope (only what a caller can observe)

| Scope | How writes are ordered | Can raise | Source |
|---|---|---|---|
| `session`, `user`, `org` | Optimistic: no queue. Version-checked writes retry on conflict (section 6). Two writes in one context can interleave. | `ConcurrentModificationError` | `cec:2654-2713`, `:2738`; `sco:222`; `t/state-container-lock.test.ts:195-236` |
| `request` | Writes in one execution context run one at a time in submission order, each persisted before the next; the version check and its retries still run underneath. A fan-out of 20 or more writes in one request all commit. A writer in another context on the same request id (a continuation started by recovery) can still conflict; the write is refreshed, re-applied and retried. | `ConcurrentModificationError` when retries are exhausted | `cec:2639-2653`; `sco:204-220`; `t/state-container-lock.test.ts:238-379`, `:402-460`, `:595-690` |
| `sequencer`, `ctx.self`, parent, target state | Writes in one container run one at a time in submission order. There is no version, so nothing conflicts and nothing is re-applied: the mutator runs exactly once. | `ScopeMutationTimeoutError` (below) | `sco:183-201`; `t/state-container-lock.test.ts:22-100` |

- **`ConcurrentModificationError` is never raised by a scope with no store.** `t/state-container-lock.test.ts:41` ("never throws ... with N=20 concurrent mutators"), `sco:183-202`.
- **`ScopeMutationTimeoutError`**: raised by a write on a scope with no store when queue wait plus mutator run time passes the budget. Fields `code` `"SCOPE_MUTATION_TIMEOUT"`, `timeoutMs`; message `State mutation exceeded <n>ms timeout (queue wait + execution).` `lock:12-22`; `t/state-container-lock.test.ts:72-100`. [test] **It is not exported from `@flow-state-dev/engine`'s root, nor from `host`** (I searched `engine/src/index.ts`, `engine/src/host.ts` and `engine/package.json`): a caller can catch it by `error.name` or `error.code`, not by class. [verify before the page names it as importable.]
- **The budget** is `request: { mutationTimeoutMs }` on `defineFlow`, default `30_000`; `Infinity` disables it. `flw:454-470` (doc comment), `cec:674` (`?? 30_000`), `cec:4086-4087` (block-instance containers). It applies only to scopes with no store: `session`, `user`, `org` and `request` do not use it. `flw:462-470`, `sco:116-125`, `t/state-container-lock.test.ts:312-340`, `:462-540` ("does not put request-scope durable writes on the non-cancelling mutation timeout"). [test]
- A timed-out mutator keeps running; if it finishes, its result still commits. A caller that retries on the timeout can apply the write twice, so a retried write should be idempotent. `mm:278-280`; `lock:24-30`. [impl]
- **Lock is not reentrant**: a mutator that calls a write on the same container waits on itself forever (the timeout is the only way out). `mm:286-311`. Writes to a different container (request versus session) from inside a mutator are fine. Pass 5: no test pins the deadlock; `t/state-container-lock.test.ts` has no reentrancy case. [verify or cut.]
- Request state is written to the store on every mutation (`cec:2639-2653`), so a paused request restores it on continue. `mm:51`.

## 10. The `state_change` item each write emits

Every committed write emits one `state_change` item on the request's stream, after the write. A write that returned `false` emits nothing. `emit:94-278` (wrappers), `emit:159-256`; `t/context/scope-emit.spec.ts:65-120`. [test] Type: `item:573-578`.

Item fields: `type: "state_change"`, `scope` (`"request" | "session" | "user" | "org" | "block_instance"`), `operation`, `path?`, `delta?`, `version` (required, the container's version after the write), plus `blockInstanceId?`, `requestId`, `itemIndex`, `provenance`, `transient`, `ts`. `item:573-578`, `emit:30-72`.

| Call | `operation` | `path` | `delta` |
|---|---|---|---|
| `patchState({ ... })` | `"patch"` | none | The object you passed, as you passed it. `emit:151-198`; `t/context/scope-emit.spec.ts:78`. |
| `patchState(key, updater)` | `"patch"` | the key | `{ path: key }`. The computed value is not in the delta. `emit:160-175`; `react/test/mergeStateChangeIntoSnapshot.test.ts:141` ("skips patch deltas that carry the keyed-updater shape (no resolved value)"). |
| `setState(next)` | `"set"` | none | The whole `next` object. `emit:199-209`. |
| `incState({ f: n })` | `"increment"` | none | The increments you passed (`{ f: n }`), not the new totals. `emit:210-218`. |
| `pushState(f, v)` | `"push"` | `f` | The one value appended. `emit:219-226`. |
| `setStateRecord(f, k, v)` | `"patch"` | `"f.k"` | `{ f: { k: v } }`. `emit:227-238`. |
| `deleteStateRecord(f, k)` | `"delete_key"` | `"f.k"` | `{ f: k }`. `emit:239-250`. |
| `atomicState(...)` | `"atomic"` | none | None. `emit:251-278`. |

- **`state_change` items are for the browser's cache and DevTool, not a log of values**: the delta is what you asked for, not what the store holds afterwards. A re-applied or merged write emits the intent as passed. [impl, follows from the table].
- Request scope's items are emitted too (`scope: "request"`), but the browser has no request `clientData` slot and ignores them. `react/src/internal/mergeStateChangeIntoSnapshot.ts:1-30`, `react/test/mergeStateChangeIntoSnapshot.test.ts:70-110`. Reduction applies only to `session`, `user` and `org`. [test]
- The React layer merges a delta into its `clientData` only for keys the flow exposes and already holds; `increment`, `push`, `delete_key`, `patch` and `set` merge, `atomic` and the keyed-updater patch carry nothing to merge. `react/src/internal/mergeStateChangeIntoSnapshot.ts:1-30`; `react/test/mergeStateChangeIntoSnapshot.test.ts:125-320`. That is `reference/react`'s row; here one line pointing there. [ref]
- `block_instance` scope (ctx.self, sequencer, parent, target state) drops a write from the stream when every field it changed is a transient key. Outer scopes never filter. `emit:105-125`, `t/context/scope-emit.spec.ts:121-270`. [test]

## 11. Session state can hold readonly fields

- A top-level `.readonly()` field in the flow's session `stateSchema` is set when the session is created. A write that would change it, from any block, tool or action, is refused before anything is written and throws `ReadonlySessionStateError`: `code` `"readonly-session-state"`, fields `flowKind`, `sessionId`, `field`; message `Session "<id>" of flow "<kind>" can't change state field "<field>": it is readonly, set when the session was created. Start a new session for another value.` `flw:362-367`, `sb:455-496`, `cec:2673-2705` (`guard` on session ops), `sco:174-181` (guard runs on every proposed state, on every retry); `t/session-birth.test.ts:323-340` ("refuses through every write ... while other fields still write"). [test] Exported from `@flow-state-dev/engine/host` (`engine/src/host.ts:10`).
- Only a plain `z.object` at the top level is read for readonly fields. `flw:366-367`.
- User and org scopes have no readonly guard. [verify: `cec:2654-2672`, `:2738` show none].

## 12. `ctx.org` typing (row carried from state-and-scopes)

- `ctx.org` is typed optional: `org?: OrgScopeHandle<TOrgState>`. `blk:355`. Read it as `ctx.org?.state.field` in TypeScript.
- It is present on every execution: every request runs in an organization, so the org scope exists. `t/context.test.ts:81-83` ("Every execution now runs in an organization, so the org scope is always present"); `apps/docs/docs/server/authentication.md` "Every request runs in an organization". [test]
- An org write returns the same booleans as any other scope. [ran: `ctx.org.incState({ licenses: 2 })` returned `true`, state `{ licenses: 2 }`.]
- Org identity: `{ type: "org", id, userId, orgId }`; in dev `id` is `DEFAULT_ORG_ID` (`"__fsd_default_org__"`). [ran]; `blk` `OrgScopeHandle` at `sc:334-338`.
- Where the organization comes from is the Authentication page's. Not here.

## 13. Two blocks declaring one state field (row carried from resources)

The row: "two blocks declaring one field with different types fail at flow build". Checked: **true, and wider than the row says.**

- `defineFlow` merges every declaration of each scope's state schema (the flow's own, each reachable block's, each capability's) and throws when two disagree on a field. It covers `session`, `user` and `org`. `core/src/flow/defineFlow.ts:803-826` (`for (const scope of STATE_SCOPES)`), `smerge:1-37`.
- The error is `ScopeStateSchemaConflictError` (exported from `@flow-state-dev/core/helpers`, `core/src/helpers/index.ts:41`) with `conflict` `"type" | "default"`, `path`, `first`, `second`, `detail`. Message shape: `Flow "<kind>": session.state.<field> is declared twice with different types: block "a" types it as string and block "b" as number. Declare one type, or share one schema for the field.` `smerge:62-96`, `:343-360`; `engine/test/scope-state-defaults.test.ts:878-925` (type conflict at any depth, nullable on one side only, the flow's own versus a block's, two capabilities). [test]
- Two blocks that give one field **different defaults** are refused too: `... is declared twice with different defaults: block "planner" defaults it to "plan" and block "writer" to "write".` `engine/test/scope-state-defaults.test.ts:889-897`. [test]
- What does not conflict: the same schema object declared twice (one declaration); fields only one declaration names (unioned, at any depth); one declaration adding outer wrappers (`.default()`, `.optional()`, `.readonly()`) to the other; two equal static defaults. `smerge:15-30`; `core/test/scope-state-merge.test.ts:133-173`. [test]
- A default declared as a factory is not compared: two declarations agree on a factory only if it is the same function. `smerge:28-30`, `:53-100`. Factory defaults in user and org scope are refused outright. `smerge:92-100` (doc comment on `refuseUnstoredFactoryDefaults`).
- The merged schema fills defaults on read and reads readonly fields; writes validate against each declarer's own schema. `smerge:31-35`.
- **Conflict with `sas:102` (existing page):** "Block declarations shape the types. They don't fill in defaults when a run reads stored state". The code does fill a block's default on a fresh session/user/org (`engine/test/scope-state-defaults.test.ts:292-345` per the state-and-scopes sheet, and [ran] here: a block-declared `visits` default read as `0`). The code wins; the page states the code's behaviour.
- The row on the resources page says "the failure sentence only". The sentence: two blocks that declare one session field with different types fail at `defineFlow`, naming the field and both blocks.

## 14. What this page does not cover (carried or cut)

- **Resource state mutators** (`patchState`, `setState`, `updateState`, `incState`, `pushState`, `getOrPatchState`, `writeContent` on `ctx.resources.<name>`) share names with the scope operations but take a version check on every one, refuse a result that fails `stateSchema` (`ValidationError`), refuse a wrong-typed delta with `resource_delta_refused`, and have their own retry driver. They are the Resources page's (R-08): `mm:63-216`, `ops:11`, `engine/test/resource-delta-verbs.test.ts`. The state-operations page needs one sentence: "Resource state has its own operations with the same names and a different rule; see Resources." [ref: R-08]
- Mechanism cut (internals, per the sitemap): the dispatch diagram, `applyMutation`, `runWithCAS`, `withScopeLock`, hints, `createScopePersist`, the per-key queue, tombstones, markers.
- `updateStateWith` and `withOutcome` (`@flow-state-dev/core/helpers`): `withOutcome(run, updater)` returns the `result` of the updater invocation that committed, for any runner that applies a mutator, including a scope's `atomicState`; `updateStateWith(ref, updater)` is it bound to a resource's `updateState`. The updater returns `{ state, result }`. Returns `undefined` if no invocation completed. `usw:1-17`, `:42-110`; `core/test/update-state-with.test.ts`. Table row: "a mutator may run more than once, so report its outcome with `withOutcome`". The repo check `scripts/validate-updater-purity.mjs` is contributor tooling: cut.
- `ctx.request.identity` / `incarnation`, `ScopeIdentity`, `OrgRequiredError` for `runAction` callers: `reference/blocks`, `reference/authentication`.
- "How much to keep in state: nothing caps the size" (`ops:375`): [verify] I found no size limit in the scope-state path. Keep as one table line only if pass 5 confirms by running; otherwise cut.

## 15. Runs made in this pass

All against `createExecutionContext` with `createInMemoryStores()` from `packages/engine`, two execution contexts sharing one store; throwaway files `packages/engine/test/zz-fact-probe*.test.ts`, deleted. They confirm the [ran] rows above. Summary of observed returns:

- Two contexts `incState({ n: 1 })` each: both `true`, stored `n: 2`. Same on a default-only field `visits`: stored `2`.
- Two contexts `pushState("hist", ...)`: both `true`, `["a","b"]`.
- Two contexts `patchState({ owner })`: both `true`, last stored wins.
- Stale single-field `patchState({ mode: "chat" })` over a stored `"agent"`: `false`, store still `"agent"`.
- Stale two-field `patchState({ a: 7, mode: "e" })` over `{ a: 5, b: 5 }`: `true`, `{ a: 7, b: 5, mode: "e" }`.
- `setState({ mode: "set" })` over a record another context had added `extra` to: `true`, stored state exactly `{ mode: "set" }`.
- `patchState("owner", c => c ?? "worker-b")` after `"worker-a"` stored: `false`, stays `"worker-a"`.
- `atomicState` with a stale copy: mutator ran twice, result combined both changes.
- `maxRetries: 0` stale `atomicState`: threw `ConcurrentModificationError`, `code "concurrent_modification"`, `retryable true`, `attempts 1`.
- `pushState("txt", 1)` on a string field and `incState({ txt: 1, visits: 1 })`: threw the messages in section 1; `visits` unchanged.
- `patchState({})`, `incState({})`, `incState({ visits: 0 })`: `false`. `setStateRecord` twice with equal value: `true` then `false`. `patchState({ nn: NaN })` twice: `true`, `false`.
- Session record deleted, then `incState`: `false`, no record created.
- `ctx.session.state.n = 5`: no throw, local read `5`, stored `1`.

## 16. Audit of rows other pages moved here

Command: `grep -rhE --include=*.record.md -e '→ R-07( \(corrected by pass 5\))?$' docs/contributing/docs-revamp/pages`. Five rows. Each checked against code.

1. **`concepts/resources.record.md`: "Session state field collision: two blocks declaring one field with different types fail at flow build (the failure sentence only; ...)". CARRIED, widened.** Checked in section 13: true for session, user and org; also for different defaults and nullable mismatch. Source `core/src/flow/defineFlow.ts:803-826`, `smerge:343-360`, `engine/test/scope-state-defaults.test.ts:878-925`.
2. **`concepts/state-and-scopes.record.md`: "Operation semantics: incState adds to a number as one step; patchState merges fields; state is read-only on ctx and changes only through these calls." CARRIED with one correction.** `incState` adds (one step: a multi-field call applies all or none, `t/inc-state-wrong-type.test.ts:55-71`). `patchState` merges top-level fields (`sco:358-365`). "State is read-only on ctx": true as a type (`Readonly<TState>`, `sc:226-250`) but not enforced at runtime: assigning to `ctx.session.state` does not throw and is not stored (section 8, [ran]). The page should say "writes go through the operations"; it should not say assignment is refused.
3. **`concepts/state-and-scopes.record.md`: "ctx.org typing: ctx.org is typed as optional but present on every execution, so reads use ctx.org?.state." CARRIED.** `blk:355`; `t/context.test.ts:81-83`. Section 12.
4. **`reference/concurrency.record.md`: "Concurrent writes: stale-read write refused and re-applied; increment and append handed to the store; plain single-field write last-write-wins." CARRIED, with a scope note.** True for scope state: a version-checked write that loses is refreshed and re-run (`cas:164-222`); single-field `incState`, `pushState` go to the store as one operation (`t/scope-persist-routing.test.ts:191-232`); a plain single-field `patchState` is last-write-wins ([ran]). The note: "increment and append handed to the store" holds only when the store offers the verb, which every built-in store does for these two (section 7); "stale-read write refused" is a scope-state sentence, not true of resource `writeContent` (no version). Resource state is R-08's.
5. **`build/your-first-flow.record.md`: "State operations: `patchState` writes the value computed in the block, `incState` adds in the store and is safe under concurrent requests, and what the emitted `state_change` delta holds for each." CARRIED, three qualifications.** (a) `patchState({ f: v })` with one field is a blind write of the value the block computed: last write wins, so a read-then-patch counter loses updates under concurrency (the example `examples/hello-chat/src/flows/hello-chat/flow.ts:58-66` reads `messageCount` and patches `count + 1`; `incState({ messageCount: 1 })` is the safe form). (b) `incState` "adds in the store" only for a single field; a multi-field call is version-checked and re-run (section 5); both are safe under concurrency, but the multi-field one can throw `ConcurrentModificationError` after the retry budget. (c) The delta of `patchState({f:v})` is the object passed; of `incState`, the increments passed, not the totals; of `atomicState`, none (section 10).

No row dropped. Rows that other pages did not move but the sitemap's source pages carry, and which this sheet cuts, are in section 14.

## 17. Disagreements between the existing pages and the code (code wins)

| Existing page says | Code says | Source |
|---|---|---|
| `ops:350`: `err.code` is `"CONCURRENT_MODIFICATION"`. | `"concurrent_modification"`. | `fe:361-362`; [ran] |
| `sas:102`: block declarations do not fill defaults on read. | They do. | `engine/test/scope-state-defaults.test.ts:292-345`; [ran] |
| `sas:137`: two blocks declaring one field with incompatible types is "a type error during flow construction". | A runtime throw from `defineFlow`: `ScopeStateSchemaConflictError`. | section 13 |
| `st:26-33` (doc comment): `true` when changed, `false` when equal, "in which case the framework suppresses the persist call". | The no-op is skipped against a verified store read for version-checked writes and against this context's copy for the rest; a write can return `true` with the stored value unchanged and `false` with the store holding something else. | section 4; `t/scope-state-noop-stale-read.test.ts` |
| `ops:112`: "`ctx.session.state` reflects writes from earlier in the same request." | True for this context. Another context's writes are not seen until this context writes. | [ran] |
| `mm` / `ops`: "state is read-only on ctx" (state-and-scopes row 2). | Type only. | [ran] |

## 18. Figures

The sitemap entry names no figure for this page. Tables only.

## 19. Open for pass 5

1. Run: stale single-field `patchState` no-op returns `false` (only [ran] here, no test).
2. Run: `deleteStateRecord` on the filesystem store and on request state after another writer moved the record (section 7). I did not run it.
3. Confirm or cut: non-reentrant lock deadlock (section 9), "nothing caps the size of state" (section 14), `ScopeMutationTimeoutError` being importable (section 9).
4. Decide whether the 4-attempt bound for first-time `incState`/`pushState` on a default-only field belongs on the page (section 6).
5. `setStateRecord`'s "last write wins on that key" and `deleteStateRecord`'s "removes the key" are from `ops` and the code's routing; I did not run two-writer cases for them.

## 20. Pass 8 (revise 1)

- Page title and H1 are "State operations"; the plan id is not published.
- `request.mutationTimeoutMs` confirmed on `RequestConfig` (`flow.ts:470`, `cec:673-674`). `ctx.org` present on every execution confirmed (`t/context.test.ts:81-83`).
- The calls that check the stored version are named by a column in the operations tables (renamed "Retries on conflict" in section 22); the page no longer refers to an unmarked table.
- Rows moved out of the page and linked: item fields and browser visibility (items), `ConcurrentModificationError` fields (errors), `cas` and `mutationTimeoutMs` settings, readonly-field rule and block-state declaration merge (flows), store verbs (stores), resource write rules (resources). The `cas` example was removed with the setting.

**Block state lifetime (pass 8).** Page states: no scope record, invisible to other requests; sequencer state is checkpointed and restored on resume except `transientSlot()` fields; a handler's `ctx.self` is not checkpointed. (Corrected in the final fact check: the earlier "gone when it finishes, never persisted" was untrue for sequencer state.) Basis: row 43 above and `apps/docs/docs/advanced/sequencer-state.md:7` ("lives for one execution of one sequencer instance ... When the run finishes, the state is done"). Durable sequencers checkpoint it for resume (`:123`); `docs/architecture/state-and-scopes.md:125-131` for `transientSlot()`.

## 21. Pass 8 (revise 3)

- `true` emits a `state_change` unless no stream is open for the request (`emitStateChangeItem` returns when the response has no `emitItemAdded`/`emitItemDone`, `scope-emit.ts:41-50`) or the call changed only block-state fields declared with `transientSlot()` (`advanced/sequencer-state.md:164-197`, `scope-emit.ts:83-110`).
- `setState` is the one call that disturbs another writer's different fields (section 6, [ran]); the "different fields never disturb" sentence excepts it.
- `patchState("owner", updater)` re-runs only when the stored version moved between this execution's read and write (section 6, [ran] race). If the other writer committed before this execution read, the updater runs once, the result equals the copy, and the call returns `false` (section 4).
- `deleteStateRecord` fallback: the page states the observable behaviour (not retried, same `false` on repeat); the version mechanics stay in section 7.
- Block state: not a scope record; sequencer state is checkpointed for resume except `transientSlot()` fields (`sequencer-state.md:123`, `:164`).

## 22. Final revise round

- **Column renamed "Retries on conflict"**, introduced once in plain words under The operations: such a call notices another writer changed the record after this request read it, re-reads, re-applies and tries again. Same split as section 5 (version-checked = retries; the right column = one store operation, no retry). `state-container.ts:136-160` (`applyMutation` doc: commutative hints to `runCommutative`, everything else to `runWithCAS`), `:248-306` (`runCommutative`: one persist, no retry). The phrases "version advanced by one" / "did not move" are cut from the returns table: a reader has no read path for the version on this page.
- **"Execution" replaced by "request"** (and "run of its block" for block state). An execution context is created per action run, `execution/runAction.ts:2089` (and per view, `runView.ts:312`), so "this execution's copy" is this request's copy. Request scope's `ConcurrentModificationError` case: a second run on the same request id writing at once, which arises when recovery starts a continuation while the original run is still live. `state-container.ts:98-108` (`serialize` doc: "still covers a writer in a different execution context"), `:200-216` (the recovery-continuation comment). Same-request parallel writes serialize under `withScopeLock` and never conflict (`:200-209`), so "any number of parallel writes in one request all commit" and the error case do not contradict.
- **`deleteStateRecord` settled.** It carries the `deleteField` hint, commutative, so it never retries ("No" is right). Where the store offers `deleteField` (in-memory, SQLite, Postgres on session/user/org) the store removes the key with no version check and other keys survive. Where it does not (request state on every built-in store; every scope on the filesystem store, section 7) `createScopePersist` falls back to a full-record `set` at the held version (`scope-persist.ts:192-207`), sent once; a lost race returns `false` and the container is not refreshed (`state-container.ts:271-297`). That is how a call that does not retry can lose. The page now says this in the operations row, the concurrent-writes row, the returns table, and as an exception to "different fields never disturb each other" (the fallback loses to a write on any field, since it is checked against the whole record's version).
- **`withOutcome` signature** (`core/src/helpers/update-state-with.ts:75-78`): `withOutcome<TState, TNext, TResult>(run: (mutator: (state: TState) => TNext) => Promise<unknown>, updater: OutcomeUpdater<TState, TNext, TResult>): Promise<TResult | undefined>`. The updater returns `{ state, result }` (`UpdateOutcome`); `state` goes to the runner. The outcome is reset per invocation and set from each completed one, so the value returned is the last completed invocation's, the one whose state the runner used; `undefined` when none completed (`:56-70`, `:84-110`). Exported from `@flow-state-dev/core/helpers` (`helpers/index.ts:47`, `package.json` `./helpers`).
- **Delete-race repetition** in Concurrent writes cut; the rule lives in What a write returns.
- **`defineFlow` field-type sentence** moved from The `state_change` item to the note under What throws (section 13 basis unchanged).
- **Resource state** sentence now says "retries on conflict": resource mutators are version-checked and run their own retry loop (`stores/resource-cas.ts:228-232`).
