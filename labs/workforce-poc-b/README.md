# Workforce POC lab B — reply-storm / claim

Throwaway L2-on-L1 proof. **Never merge.** No Workforce package, no Channel /
Team / MessageBoard L1, no new board-lock type.

## The question

Group fan-out already wakes N subscriber sessions. If they all answer, that is
a reply storm. Can Layer 2 stop that **without** a new L1 lock — using the
task-board claim that already exists?

## Convention

A board post is a `pending` row on a user-scoped `defineTaskCollection`. The
board is the working set. Each subscriber has their own session. A post wakes
N of them via `dispatcher({ type: "internal", session: { key } })`.

A wake is not a turn.

| On wake | L2 policy | Who replies |
|---|---|---|
| Unaddressed, no `needsReply` | Default quiet | Nobody |
| `@name` / `addressedTo` | Only the named subscriber may attempt a claim | That subscriber, if they win the claim |
| Unaddressed + `needsReply` | Open claim — anyone may attempt | Exactly one, via L1 CAS |

Without the policy (`policy: "off"`), every wake replies. That is the storm.

## L1 claim API used

**`TaskCollectionRef.claim(workerId, { eligibility })`** from
`@flow-state-dev/orchestration`, reached as:

```ts
const collection = await ctx.cap.replyBoard.tasks();
const claimed = await collection.claim(subscriberId, {
  eligibility: (task) => task.id === postId,
});
```

That is the same CAS claim `taskBoard` drain uses (`createClaimTask` →
`dispatcher.claim` → `collection.claim`). Eligibility **narrows** the
substrate's candidate set to this post's row; it does not replace
`isClaimable`.

Installed through `defineTaskCollection({ id: "boardPosts", scope: "user" })`
and `taskBoard({ collection, … }).capability`. **`board.drain` is never
called.** Drain would keep claiming until the board is empty — the opposite
of "default quiet."

`claim(workerId)` is trace attribution. Who spoke is recorded on
`collection.complete` output (`subscriberId`), not by inventing a lock field.

## What this is not

- Not a MessageBoard / Channel / Team package
- Not a new claim or lease type
- Not `taskBoard.drain` as the reply loop
- Not a multiparty session

## Proof

```bash
pnpm --filter @flow-state-dev/workforce-poc-b test
```

| Case | Wakes | Replies |
|---|---|---|
| Policy off | 3 | 3 |
| Default quiet | 3 | 0 |
| Addressed `@bob` | 3 | 1 (`bob`) |
| Open-claim (concurrent `receive`) | 3 | 1 (CAS winner) |
| `post` fan-out + quiet | 3 dispatcher handles | token stays `pending` |
| `post` fan-out + open-claim | 3 dispatcher handles | 1 completed row |

If concurrent `claim` on one post ever admitted two winners, that would be an
L1 gap for Architect — this lab would stop, not invent a board-lock.

## Cuts

No changeset. Private lab. Close the PR unmerged when the finding is consumed.
