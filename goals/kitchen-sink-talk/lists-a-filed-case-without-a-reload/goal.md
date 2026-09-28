# kitchen-sink-talk › lists a filed case without a reload

**Issue:** FIX-1622 (VG of the spec's PLAN; the epic FIX-1592). FIX-1601's closure (P2e) re-runs it.

**Outcome:** A person who asks `support.help` for a real person sees the case appear in the escalations panel as a row with its status, in a list, with no reload, in that tab and in any other tab open on the demo.

**Input:** `fixtures/input.json`: the channel and its board (`support.help`, `escalations`), the specialist a case is routed to (`support.devices`), the scenario marker the scripted specialist files on (`[scenario:needs-a-person]`), the status every filed row shows (`pending`, since nothing works the board), how long a row may take (10 s), how many board reads a tab may make meanwhile (2), and the idle window (10 s). Held-out: each run files two cases, each with a fresh `case-token-…`, and only those tokens are graded, so a row another run left on the shared board can never be the one that passes. `GOAL_SEAT` routes both cases to another specialist.

**Signal:** two tabs on kitchen-sink's **production build** (built by the run, never assumed), served by `next start` on the scripted model, the in-memory store and **no model key**. Tab 2 is opened first and never picks anything; tab 1 opens `support.help` and posts both cases, the second once the first has settled. Everything graded is read off the two pages as drawn; each tab is reloaded once, for the last leg only.

- **row**: within 10 s of Send, tab 1's escalations panel holds a row carrying the case's token. The second case's row shows above the first's (newest first).
- **other-tab**: the same, in tab 2.
- **status**: every time a case's row is drawn, in either tab, open or after the reload, its status word reads `pending`, and the board draws no status column (`[data-column]`). A row drawn nowhere fails it: there is no status to read.
- **once**: no reading while the tabs are open shows a case's row twice, and after the final reload each case is exactly one row in each tab.
- **no-poll**: each tab reads the board (`GET …/sessions/<id>/resources/support.help.escalations`, through whichever session) at most twice between Send and the row, and not at all in a 10 s window after the first case has settled.

**Anti-game:** the panel as drawn, never the ledger, the specialist's "filed" line, or a response. A reload or navigation in either tab before **once** voids the run (`void`). Tab 2 never picks the channel, so a list that re-reads when its own page sends cannot pass **other-tab**. The run reads the server only to know when a case has settled (the specialist's line is kept, and the board holds the row); that read is not graded. Only this run's tokens count.

**Model:** n/a. kitchen-sink's scripted model routes each post by the specialist it names (`[route:…]`), and a specialist sent `[scenario:needs-a-person]` files the case onto `escalations` through the channel and says so. Keyless: the server runs with `AI_GATEWAY_API_KEY` empty.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-talk/lists-a-filed-case-without-a-reload/run.mts`

**Controls:** on the same command.

- `GOAL_CONTROL=no-live`: the page is opened with `?goalControl=no-live`, which a test-mode build honours (`apps/kitchen-sink/lib/goal-control.ts`, `pageGoalControl`) by leaving the rail's panels and the team panel's boards without `live`. Nothing shows until the reload, where the list is right. Must FAIL at **row** and **other-tab**, and at nothing else.
- `GOAL_CONTROL=main`: the app before the list, run from a checkout of `main` with this directory copied in. Its board draws status columns, read once through the assistant's session. The app knows no control by that name; it tells the run which legs must fail. Must FAIL at **row**, **other-tab** and **status**, and at nothing else.
- `GOAL_CONTROL=no-filing`: the server swaps the specialist's `escalate` for a stand-in that says it filed and files nothing (`apps/kitchen-sink/lib/escalate-control.ts`). The line still says "filed", so it must FAIL at every leg but **no-poll**: **row**, **other-tab**, **status** and **once**.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-28 | FIX-1622 branch at 91a5afdc4, this directory uncommitted | scripted | **PASS** | First run, taken before any control, so it proves nothing on its own; re-taken below after all three controls failed. Fresh production build, keyless. Case 1: tab 1 row +0.8s, tab 2 row +0.2s, one board read each. No board read in either tab in the 10s idle window. Case 2: tab 1 +0.7s, tab 2 +0.1s, above case 1, one board read each. After the reload each case is one row in each tab; every row drawn reads `pending`, in one list. |
| 2026-09-28 | FIX-1622 branch at 91a5afdc4, this directory uncommitted | scripted | FAIL (control) | `GOAL_CONTROL=no-live`. Failed at **row** and **other-tab** (both cases, both tabs: no row within 10s, no reload) and nothing else. After the reload the list showed each case once, `pending`, no columns. |
| 2026-09-28 | FIX-1622 branch at 91a5afdc4, this directory uncommitted | scripted | FAIL (control) | `GOAL_CONTROL=no-filing`. Failed at **row**, **other-tab**, **once** (0 rows per case per tab after the reload) and **status** (no row ever drawn), and nothing else. **no-poll** green: nothing changed, so nothing was read. |
| 2026-09-28 | `main` at cb00fc4f0, this directory copied in | scripted | FAIL (control) | `GOAL_CONTROL=main`. Failed at **row** and **other-tab** (no row in either tab, either case, before the reload) and **status** (after the reload each row sits in one of 7 status columns and draws no status word), and nothing else. **once** and **no-poll** green. |
| 2026-09-28 | FIX-1622 branch at 91a5afdc4, this directory uncommitted | scripted | **PASS** | Re-taken after the three controls. Case 1: tab 1 +0.7s, tab 2 +0.2s; case 2: tab 1 +0.7s, tab 2 +0.3s, above case 1; one board read per tab per case; none in the idle window. Each case once per tab after the reload, `pending`, one list. |
| 2026-09-28 | FIX-1622 branch at 91a5afdc4, this directory uncommitted | scripted | **PASS** | Held-out: `GOAL_SEAT=support.accounts`. Case 1: tab 1 +0.7s, tab 2 +0.2s; case 2: tab 1 +0.8s, tab 2 +0.3s, above case 1; one board read per tab per case; none idle. Each case once per tab after the reload, `pending`, one list. |
| 2026-09-28 | FIX-1622 branch at a55b0b454 (review round 1: a live list reads on mount and once more when its stream connects, with no clock margin; `baseUrl` prop) | scripted | **PASS** | Fresh production build, keyless. Case 1: tab 1 +0.7s, tab 2 +0.2s; case 2: tab 1 +0.8s, tab 2 +0.4s, above case 1. One board read per tab per case between Send and the row (the two mount reads land before Send); none in either tab in the 10s idle window. After the reload each case is one row in each tab; every row drawn reads `pending`, in one list. |
| 2026-09-28 | same | scripted | FAIL (control) | `GOAL_CONTROL=no-live`. Failed at **row** and **other-tab** (both cases, both tabs: no row within 10s, no reload) and nothing else; the run found no `[control]` problem. |
