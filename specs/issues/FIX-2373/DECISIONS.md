# FIX-2373 · Decisions

[Spec](SPEC.md) · **Decisions**

<a name="d1"></a>
## D1 · The bar shows on `lapsed` and `stopped`, not on `reconnecting`

The issue asks for a "Reconnecting (attempt n)" bar as well as "Lost the server". FIX-2374's
feed has five states ([its D2](../FIX-2374/DECISIONS.md#d2)) and no attempt count.

| | Bar on `lapsed` and `stopped` (chosen) | Bar from `reconnecting` on, with an attempt count |
|---|---|---|
| The server's ordinary close every 15 minutes | Nothing shows: the first retry fixes it in under a second | A flash of "Reconnecting (attempt 1)" each time |
| A server that is really gone | The bar shows once a retry has failed, about a second later | The bar shows at once |
| Change to FIX-2374's artifact | None | An `attempt` field on the snapshot, asked of its owner (ER-4) |

- **Because:** `lapsed` already means "a retry failed, what the feed last said may be out of
  date", which is exactly the sentence the bar says. A bar that flashes on routine closes teaches
  people to ignore it.
- **Locks in:** `isFeedStale(state)` is `state === "lapsed" || state === "stopped"`, the only
  definition, used by the bar and by every stale style.
- **What would change it:** a close that takes several seconds to retry in practice. Then the
  bar starts on `reconnecting` after a short delay, still without a count.

<a name="d2"></a>
## D2 · A failed refresh after boot keeps the shell; the full-screen page is for the first read

| | Keep the last good snapshot, show the bar (chosen) | Today: swap the shell for `Unreachable` |
|---|---|---|
| Route, open task, a typed draft | Kept | Lost |
| What the screen says | The bar: the data is from N seconds ago | The truth, but at the cost of everything on screen |
| A refusal (401/403) on a later read | Full screen, as today: Shift Manager must not keep drawing a Lab it is no longer let into | Full screen |

- **Because:** a later failure means the server went away, not that the snapshot is wrong.
- **Locks in:** Shift Manager's snapshot read reports its health in the feed's vocabulary:
  `live` after a read lands, `lapsed` after a later read fails. It is the read's own result, not
  a counter. The bar takes the worst of that and the state of the feeds on screen.
- **What would change it:** none expected. FIX-2409 adds more refreshes; each goes through the
  same rule.

<a name="d3"></a>
## D3 · Three PRs, in the epic's build order

The epic's [build order](../../epics/FIX-2369/DECISIONS.md#coordination-seams) puts this issue in
three places: after FIX-2374 as a package dependent, in Shift Manager's wave-2 stack after
FIX-2408, and, since the labs' bar reads the feed, after each lab's FIX-2374 stack.

| PR | Holds | Base |
|---|---|---|
| 1 · registry | `connection-banner.tsx` (the bar, `isFeedStale`, `STALE_CLASS`), `connection-screen.tsx`, `registry.json`, stories, tests, the ui README | FIX-2374's branch, then `main` once it merges |
| 2 · Shift Manager | Installs both, deletes `Refusal`/`Unreachable`, D2's keep-the-shell rule, stale styling and stopped clocks in `Tasks.tsx`, `TaskFrame.tsx` and the running lines | Its wave-2 stack, after FIX-2408 |
| 3 · labs | Each lab installs both, draws the bar from its feed, greys its dots and gates `useNow` on not stale; Teammates wraps its boot read in `connection-screen` | After that lab's FIX-2374 stack merges |

- **Because:** wave 1 touches no app file, and each hot file has one open stack.
- **Locks in:** the issue is Done when PR 3 merges for both labs, not at PR 1.

## Decided, not asked

- **E1 · The age counts from when the feed left `live`**, held in the bar's own state, since the
  feed carries no time. The bar's clock is the only one that keeps running while stale.
- **E2 · `connection-screen` takes its title, body and failure as props.** Two kinds:
  `refused` (no retry) and `unreachable` (Retry, plus a retry on its own at 2, 4, 8… seconds,
  capped at 30). The issue says Shift Manager's screen already retries with backoff; on `main` it
  retries on click only, so the backoff is new and Shift Manager gets it too.
- **E3 · Stale styling is a class, not a wrapper.** `STALE_CLASS` greys and stops the
  `animate-pulse`/`animate-spin` inside it; apps add it where status lines are drawn. A class keeps
  the copies Tailwind-scannable and adds no component an app has to thread through.
- **E4 · `stopped` says "The server stopped this feed"** and offers Retry only when the app passes
  `onRetry` (it reopens its feed). `close()` on unmount never draws, since the bar unmounts too.
- **E5 · The bar takes a structural `{ state }`**, as `stuck-request-banner` takes its session, and
  imports only the state type from `@flow-state-dev/client`.
- **E6 · Kitchen Sink installs both** to keep its byte-identical drift test whole, and draws
  neither: it follows sessions through `useSession`, which this issue leaves alone.
- **E7 · No changeset.** `@flow-state-dev/ui` and the apps are private.

## How it got here

- **Draft** — framed from the issue and the code on `main` at `675f614`: one health signal (the
  feed's `state`), one bar and one first-read screen in the registry, and three PRs that follow
  the epic's stacks; builds on FIX-2374's `sessionFeed` and Shift Manager's two screens.
