# workforce-privacy › it two users share a project and nothing else

**Issue:** FIX-1797 (the closure of epic FIX-1786). The milestone run is FIX-1805.

**Built so far:** the milestone only (`GOAL_ONLY=milestone`). The final run's parts (legs a to c, the leg-b controls, the pre-epic baseline, J1, part 3's manifest, part 4's seam assertions) are added by FIX-1797's closure PR once every child has merged. Until then, a run without `GOAL_ONLY` runs the milestone, and its verdict says it graded the milestone only; naming a final-run part fails and says it isn't built.

**Outcome:** two users of one Shift Manager install each build a private roster, work one shared project through workstreams they each own, and reach nothing of the other's except what was written to a shared resource or to org scope. The milestone proves the privacy half on the commit FIX-1788's last PR merges on, before anything else builds on it: Bob can't open, read, post to or create a session on anything of Alice's, and Alice in a second org sees none of her first org's workers, sessions or data.

**Input:** Shift Manager's DevTeam install as the commit ships it, served by its own command over a fresh store. Alice is its owner and Bob its second member, each with their own verified bearer, each through the shipped clients (`createWorkforceClient`, the session, resource and action clients) and in their own browser context. Held out, picked at run time: which standard worker is forked, every worker's name, and the code word Alice gives hers. Another standard worker, name or word must pass too.

**Signal:** the milestone's steps, each PASS (PLAN → The milestone):

- **m1** (action as Alice): she forks a standard worker (hires one if the commit has no fork action) under a held-out name. Her roster lists exactly that one worker of her own on its flow; the store holds one worker row for her, in a collection declared at user scope; the standard worker's row is unchanged; her Roster screen draws it. She opens its session with `ensureWorkerSession` and gives it the word; the word is in her session.
- **m2** (HTTP as Bob): opening her worker session, listing under her user id, and posting to it (as himself, and naming her user id in the body) are each refused; her session holds no new item.
- **m3** (HTTP as Bob, then a turn and a screen): his roster, his worker collection, a by-key read and a read through her own session never return her worker; he forks the same standard worker, asks his for a code word, and neither his answer nor any of his sessions' state or items holds hers; his Roster screen doesn't draw her worker.
- **m4** (HTTP as Bob): his talk action naming her worker, a create seeding `workerId` with it, and a create at the session id derived for her are each refused; the store holds no session of his on her worker and nothing at her id.
- **m5** (action as Alice in her second org, after a restart on the same store): her roster lists no worker of her own; none of her first org's sessions is listed or opens; no session there holds her word or worker; a create naming her first-org worker is refused; her Roster screen there doesn't draw it.

**Anti-game:** every change goes through the app (the shipped clients over HTTP, as that user), never a store write, a fixture or a block the check calls. Every grade reads the store through the install's routes as that user, by id, never Shift Manager's own state and never a session's stored `workerId`. Bob's requests carry Bob's bearer only. A refusal is graded together with what the store holds afterwards, so a request refused at the door but written anyway still fails. An absence on a screen counts only when the same screen drew other workers. Each model turn is graded once; a provider error re-runs that one turn and is reported. A step the commit can't run is NOT RUN, never PASS.

**Model:** real — openai/gpt-5.4-mini (the forked standard worker's own setting), on m1's and m3's turns

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers GOAL_ONLY=milestone pnpm tsx goals/workforce-privacy/two-users-share-a-project-and-nothing-else/run.mts` (add `GOAL_COMMIT=<sha>` to serve another commit from its own worktree, as each milestone rerun does). The report is written to the run's scratch directory. On demand only, never a CI gate (QR-5).

**Controls:** the milestone runs its control after the plain run, on its own store. `org-scoped-workers` (the worker collection declared at org scope, a module patch applied as the served process loads it, printed in full) must FAIL **m3** on *Bob reads Alice's worker*, with **m5** green. m1's scope assertion is skipped under it, since that scope is exactly what it changes. m4 may go red too. The scratch patch `second-org` adds a bearer for Alice in a second organization for m5, since the install has no second-org principal; it is printed in full.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-08 | ea91beb49 | openai/gpt-5.4-mini | FAIL (expected: FIX-1788 P4 not merged) | The red state. m1 FAIL: the install registers no `workforce-roster` flow, so Alice's roster read is a 404 and no flow takes `fork` or `hire`. m2 to m4 NOT RUN: no worker to reach for. m5 FAIL on the roster read; its session checks held (none of Alice's 10 first-org sessions listed or opened in her second org). `org-scoped-workers`: applies (a process with it reads the collection at org scope) but can't fail m3 on its merits here, since m1 fails first. 36 s, no model turns |
