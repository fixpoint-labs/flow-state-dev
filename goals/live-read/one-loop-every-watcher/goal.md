# live read › one loop, every watcher

**Issue:** FIX-2551
**Outcome:** Every screen kept current on change notices behaves the same, because each is the client's one live read (`client.live`): a burst of changes costs at most two reads, a change it doesn't show costs none, the last thing shown is what the store holds, and a read that fails recovers on its own in about a second with nothing else changing.
**Input:** One `serve()` host on a bound port with Kitchen Sink's workforce tree and claude-code-style's pins user resource (written through the default write flow since FIX-2624), on the crossing double (`goals/lib/crossing-bus.mts`), so push covers every topic and no fallback timer runs. Five watchers, each through its own caller's code and on its own credential: React's live `Roster` panel (react-dom over happy-dom, read off what it draws), Workforce's `watchRoster`, Shift Manager's snapshot under its real `LabProvider`, the Teammates lab's `watchWorkers`, and the claude-code-style lab's `watchPins`. Alice's other tab writes two collections: 50 hires (the roster, a resource collection) and 50 pins (her user resource). Each burst lands while every watcher's read is held in flight at its fetcher.
**Signal:**
- `a:burst <watcher>` — 1 to 2 reads for the 50 writes it shows. Shift Manager is graded on the hires only: a pin runs in a write session no listing shows (FIX-2624), so the pins are unrelated to it.
- `a:unrelated <watcher>` — 0 reads for the 50 writes it doesn't show (roster watchers and Shift Manager during the pins, the pins watcher during the hires).
- `a:equals-store <watcher>` — once quiet, it shows what the store holds: the roster's 50 workers (the `Roster` panel by how many rows it drew: it draws the org inventory's row shape, so the user's roster rows are drawn as unreadable ones and counted), the 50 pins; Shift Manager, whose snapshot shows no roster rows, by a snapshot read landing after the last hire.
- `b:recovers <watcher>` — every read answers 503 from one write (a hire for the roster watchers, then a pin) until its last notice has landed; each watcher then shows the change within 2 s with no other notice sent, so only its retry can show it. `b:failed <watcher>` checks at least one of its reads was refused.

**Anti-game:** Reads are requests the server answers, counted at each watcher's own fetcher by its token: the React panel's read of the roster's own collection, a roster view call for `watchRoster` and `watchWorkers` (they follow the roster view since FIX-2623), a snapshot's first request (`/sessions?…dispatch-runs`), the pins read. Never `read` calls against a fake `subscribe`, which would pass while a caller still loops on its own. Values are read off what each watcher draws or reports, never off the store's own notices. Real sockets on a bound port.
**Not graded:** a resource notice that names no path reads once. A hire's notice names none (FIX-2624), but the hires burst grades reads, not which notice started them; `packages/client/test/live.test.ts` covers it. Shift Manager's "0 reads for a write it doesn't show": every session it lists is heard by request, so no write here lands outside it.
**Model:** n/a (the roster and pins flows' actions write; no turn runs a model)
**Run:** `cd goals && pnpm tsx live-read/one-loop-every-watcher/run.mts`
**Controls:**
- `GOAL_CONTROL=no-coalesce` — every notice heard reads at once (`coalesce.ts`). Must FAIL `a:burst`.
- `GOAL_CONTROL=rule-says-no` — the path rule rules every path out (`paths.ts`). Fails no `a:equals-store` line today, for any of the five watchers; see "Not shown failing".
- `GOAL_CONTROL=no-retry` — a failed read schedules nothing (`live-read.ts`). Must FAIL `b:recovers` for all five watchers.

The totality half — exactly one coalescer and one path rule, both in the client — is `specs/issues/FIX-2551/poc/copy-count/check.mjs --after`, and structurally the `fsd/one-coalescer` lint.

**Not shown failing:**
- `rule-says-no` doesn't reach `a:equals-store` for any watcher. For the roster watchers (rp, rw, sm, tm): a user-scope resource notice carries no path (FIX-2624), and the live read hears a notice with no path before it asks the rule; the roster view's watch (rw, tm) passes no `paths` at all. This holds until [FIX-2625](https://linear.app/fixpoint-labs/issue/FIX-2625) narrows view topics to the resources each one read. The pins watcher (cc) filters with its own `hear` and passes no `paths` either.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-11 | claude/fix-2551-impl (pre-push) | n/a | PASS | a: 2 reads for 50 hires in each of rp, rw, sm, tm; 2 for 50 pins in cc and sm; 0 reads for the other burst in rp, rw, tm, cc · equals-store: rp drew 50 rows, rw and tm 50 of 50 workers, cc 50 of 50 pins, sm read after the last hire · b: the four roster watchers showed the hire ~1050 ms after their read failed, cc the pin ~1030 ms, no other notice |
| 2026-11-11 | claude/fix-2551-impl (pre-push) | n/a | FAIL (expected) | `no-coalesce`: `a:burst` in all five (50 reads per 50 writes; sm 200 for the pins) |
| 2026-11-11 | claude/fix-2551-impl (pre-push) | n/a | FAIL (expected) | `rule-says-no`: `a:equals-store` (rp drew 0, rw and tm showed 0 of 50), and `a:burst` 0 reads for the hires; cc, which has no paths, held |
| 2026-11-11 | claude/fix-2551-impl (pre-push) | n/a | FAIL (expected) | `no-retry`: `b:recovers` in all five; everything in a held |
| 2026-11-11 | claude/fix-2624-impl (pre-push) | n/a | PASS | The pins are the `lab-pins` user resource, written through the default write flow (FIX-2624). a: 2 reads for 50 hires in rp, rw, sm, tm; 2 for 50 pins in cc; 0 for 50 pins in rp, rw, sm, tm (a pin runs in a write session no listing shows, so sm no longer reads on it) · equals-store: 50 of 50 everywhere · b: roster watchers ~1056 ms, cc ~1017 ms |
| 2026-11-13 | 16670e72a | n/a | FAIL (a:unrelated rw, a:unrelated tm) | The roster view listens to the whole user scope until FIX-2625 narrows view topics to the resources each read, so 50 pins cost rw and tm 2 reads each. Setup has no roster session (FIX-2624): hires go through the workforce client (`runBy`), the React panel gets a roster session the page makes, rw/tm reads are roster view calls (FIX-2623). Leg b fails every read until the write's last notice lands and is graded per watcher. Everything else PASS: 2 reads for 50 hires in rp, rw, sm, tm; 2 for 50 pins in cc; 0 for the other burst in rp, sm, cc; equals-store 50 of 50; `b:recovers` rp 817, rw 1806, sm 817, tm 1806, cc 783 ms after the last notice (rw and tm had 2 reads refused, so their retry backs off 2 s) |
| 2026-11-13 | 16670e72a | n/a | FAIL (expected) | `no-coalesce`: `a:burst` in all five (rp 50, rw 250, sm 50, tm 250 for the hires; cc 50 for the pins) |
| 2026-11-13 | 16670e72a | n/a | FAIL (its leg not reached) | `rule-says-no`: fails only on `a:unrelated rw` and `a:unrelated tm`, as the unpatched run does; `a:equals-store` held in all five. See "Not shown failing" |
| 2026-11-13 | 16670e72a | n/a | FAIL (expected) | `no-retry`: `b:recovers` in all five (rp, rw, sm, tm, cc not within 2000 ms of the last notice) |
