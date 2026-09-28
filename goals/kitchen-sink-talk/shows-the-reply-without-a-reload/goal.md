# kitchen-sink-talk › shows the reply without a reload

**Issue:** FIX-1609 (VG of the spec's PLAN; the epic FIX-1592's ER-23)

**Outcome:** With `support.desk` open, a person who posts sees `support.otto is working`, then otto's line in the channel under its own name, with no reload. The same holds in otto's own conversation open in another tab.

**Input:** `fixtures/input.json`: the channel, the seat that answers there (`support.otto`), the scenario marker the scripted model keys on (`[scenario:reply-after-a-hold]`, the reply-in-channel answer held about three seconds), the marker it writes on otto's line (`[reply:in-channel]`), how long a line may take (15 s) and how many snapshot reads the page may make meanwhile (2). Held-out: each run posts three lines, each with a fresh `reply-token-…`, and only those tokens are graded, so a line another run or test left in the shared channel can never be the one that passes. The second post goes in while otto still works on the first. The third is read in a second surface, otto's own conversation for the channel, open in a second tab.

**Signal:** one real browser against kitchen-sink's **production build** (built by the run, never assumed), served by `next start` on the scripted model, the in-memory store and **no model key**. Everything graded is read off the open page; the page is reloaded once, for the last leg only.

- **working**: for each of the first two posts, the channel's panel shows `support.otto is working` in a reading before the one that first shows otto's line for that post, and before the next post is sent: a Send re-reads the runs even on a page that doesn't follow its session, so a later reading could show the row without the stream. Otto working on the first post shows the same row, so for the second the reading must also come after otto's line for the first is in: otto still working on the second once it has answered the first.
- **line**: for each of the first two posts, within 15 s of Send, the open panel shows otto's line carrying the token and `[reply:in-channel]`, labelled `support.otto` (a second copy is graded under **once**); once otto's last line lands, the working row is gone within 5 s. For the third post, otto's conversation open in the second tab shows the post heard, and otto's answer after it, within 15 s.
- **once**: no reading while the page is open shows a post or otto's line twice, and after the one reload each post and each reply shows exactly once.
- **no-poll**: between Send and the line, the page reads a session snapshot (`GET …/sessions/<id>/state`) at most twice. The same holds for the second tab and the third post.

**Anti-game:** no reload before **once**. Nothing asserted on the wire, a hook's return, a package test or a CLI run: the page's own requests are only counted, for **no-poll**, and the server's reads behind the stream are not the page's. Before the reload the run reads the channel's state until every answer is kept, so the reload grades what was kept and not how fast; that read is not graded. Only this run's tokens count.

**Model:** n/a. kitchen-sink's scripted model answers the seats (epic FIX-1592 D3): after a three-second hold, a step calling `post-to-channel` with no text, so the real tool runs, then a text step. Keyless: the server runs with `AI_GATEWAY_API_KEY` empty.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/shows-the-reply-without-a-reload/run.mts`

**Controls:** on the same command.

- `GOAL_CONTROL=no-live`: the page is opened with `?goalControl=no-live`, which a test-mode build honours (`apps/kitchen-sink/lib/goal-control.ts`, `pageGoalControl`) by leaving the rail's panels without `live`. The page stays silent until the reload. Must FAIL at **working** and **line**, and at nothing else.
- `GOAL_CONTROL=main`: today's `main`, run from a checkout of it with this directory copied in, and the scripted seat that holds (`apps/kitchen-sink/lib/e2e-mock-script.ts` and `apps/kitchen-sink/test/mock-flowstate.ts`), so the control differs from the change only in the stream and the panels. The app knows no control by that name; it tells the run which legs must fail. Must FAIL at **working** and **line**, and at nothing else.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-27 | FIX-1609 branch on 0efb98483 | scripted | FAIL (control) | **`GOAL_CONTROL=no-live`, first run, before **working** was tightened.** Failed at **line** for all three posts and at **working** for the second only. The first post's **working** stayed green: the second post's Send re-read the runs, which any page does, and the row showed without the stream. **working** now counts only a reading taken before the next Send, and for the second post only one taken after otto's line for the first. |
| 2026-09-27 | `main` at 0efb98483 | scripted | FAIL (control) | **`GOAL_CONTROL=main`, taken first after the tightening**: a checkout of `main` with this directory and the scripted hold copied in. Failed at **working** (posts 1 and 2) and **line** (posts 1, 2 and 3) and nothing else: the panel never showed `support.otto is working`, and no line arrived before the reload. **once** and **no-poll** green. |
| 2026-09-27 | FIX-1609 branch on 0efb98483 | scripted | FAIL (control) | `GOAL_CONTROL=no-live`. Failed at **working** (posts 1 and 2) and **line** (posts 1, 2 and 3) and nothing else, the same five failures as `main`. **once** and **no-poll** green. |
| 2026-09-27 | FIX-1609 branch on 0efb98483 | scripted | **PASS** | First verdict, `next start` on a fresh production build, keyless. Post 1: working +1.0s, line +4.0s under `support.otto`, 2 snapshot reads. Post 2, sent while otto worked on post 1: working +2.9s (after post 1's line), line +4.0s, 1 snapshot read. The working row went 0.1s after the last line. Post 3: heard and answered in otto's conversation in the second tab +3.9s, 0 snapshot reads. After the reload, each of the 3 posts and its reply shows once. |
| 2026-09-27 | FIX-1609 branch on 0efb98483 | scripted | FAIL (blast radius) | **working**, the second post's reading: the row hidden while the seat's line is the latest, though it still works on the next post. Failed at **working** for post 2 only. Reverted. |
| 2026-09-27 | FIX-1609 branch on 0efb98483 | scripted | FAIL (blast radius) | **line**, the row clearing: every run shown as working. Failed only at "`support.otto is working` still showed 5s after otto's last line". Reverted. |
| 2026-09-27 | FIX-1609 branch on 0efb98483 | scripted | FAIL (blast radius) | **line**, the label: every line labelled `someone`. Failed at **line** for posts 1 and 2 on the label only. Reverted. |
| 2026-09-27 | FIX-1609 branch on 0efb98483 | scripted | FAIL (blast radius) | **no-poll**: the working rows re-read the snapshot every 700 ms. Failed at **no-poll** only: 12 and 9 reads in the channel's windows, 10 in the second tab's. Reverted. |
| 2026-09-27 | FIX-1609 branch on 0efb98483 | scripted | FAIL (blast radius) | **once**, while open: each streamed item drawn a second time under another id. Failed at **once** only, otto's line twice in a reading for posts 1 and 2; the reload was clean. Reverted. |
| 2026-09-27 | FIX-1609 branch on 0efb98483 | scripted | FAIL (blast radius) | **once**, after the reload: the session snapshot holding each item twice. Failed at **once** only, while open and after the reload (each post and reply twice). Reverted. |
