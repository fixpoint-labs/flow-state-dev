# Cycle 24 — "shift-manager:dev develops Shift Manager and FSD" epic wrap (FIX-1903) (2026-10-14)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**Every child merged green, and the closure still found three product blockers. Two of them had
already shown up a day earlier, and each was fixed by editing a worker's prompt.**

The classes, checked against the ledger:
- **(a) A model's failure fixed in its prompt, with the cause in what it was handed.** Three
  instances in two cycles (cycle 22 #2768; here #3205 twice), and the costliest shape this cycle:
  both of #3205's causes came back as closure blockers. **Proposed below.**
- **(b) The closure's own checks were wrong**, for the fifth closure in a row (cycles 19, 21, 22,
  23, 24). #3367's first head restored the store outside its `finally`, dropped the WAL sidecars,
  and graded commits against a stale local `main`. FIX-1991 found the check holding
  `LINEAR_API_KEY` in its own environment. The same fault was found again, separately, by
  FIX-1797's closure (FIX-2002), which landed first. #3189 shipped a child goal where an empty
  `GOAL_LEG` printed PASS, which is FIX-1183's exact shape. FIX-1183 has been in Backlog since
  09-18. **An owner ask, not text.**
- **(c) Checks that rot between merge and closure.** Two of the five closure finds came from
  sibling work merged after this epic's children: FIX-1872 moved the chief of staff's dispatch
  onto a path leg b never ran, and FIX-1920 and FIX-1872 left the DevTeam wake check (FIX-1966)
  failing on `main`. The same pair left `main` red on a test still calling `handOff` (#3232 then
  #3263), which #3261 and #3272 each ported a fix for. Between 10-12 and 10-14 at least seven PRs
  fixed a goal check that had drifted behind `main` (#3150, #3265, #3299, #3343, #3345, #3346,
  #3349). Model-free goals never run in CI, by design (`goals/README.md`). **An
  owner ask, not text.**
- **(d) A direction artifact merged before its requested Codex pass posted.** #3198 (FIX-1927's
  spec) merged at 23:59:52Z. Codex posted at 00:04Z with a P1, *"keep upstream fetches inside the
  operator trust boundary"*, and that is the invariant #3201 then spent waves r2–r7 on. #3179
  (the epic amendment) merged a minute before its Codex P2, and the end-state figure it named
  still says *"endpoint and credential in host config"* on `main`. **An owner ask, not text.**
- **(e) The owner reversed a call the epic made in a *Locks in* row.** FIX-1903 D4 compared
  *where* a run gets its MCP servers (coordinator or run start). *Who holds the connection and the
  key*, FSD or Claude Code's own MCP config, was a consequence in its *Locks in* row and never an
  alternative. FIX-1905's D2 inherited it, and the owner rejected it at spec review: *"D2 can't be
  through Claude… related to meta harness stuff"*. That took epic amendment #3179. One instance.
  **Recorded, and routed to the project's decided-once list** (below), not to the grounding.

**Proposal:** one sentence in tenet 5, saying that a prompt is a call site.

**Method: scope.** 18 reviewed artifacts. The epic's Linear children (FIX-1904, 1905, 1906, 1919,
1965, 1966, 1971, 1973, 1991) and their attachments were read over GraphQL. The 400 newest
repository PRs were matched on those ids and the three outside-epic issues the coordinator named
as born from the epic (FIX-1926, 1927, 1957).
- **Direction artifacts (6):** the epic PR #3164, its amendment #3179, the issue specs #3175
  (FIX-1904), #3177 (FIX-1906) and #3174 (FIX-1905), and #3198 (FIX-1927, outside the epic).
- **Implementation (12):** #3185 (FIX-1906); #3189, #3194 and #3205 (FIX-1904); #3261
  (FIX-1905); #3308 (FIX-1965); #3299 (FIX-1966); #3317 (FIX-1971 and FIX-1973); #3367 (FIX-1919
  closure and FIX-1991). Outside the epic: #3199 (FIX-1926), #3201 (FIX-1927), #3272 (FIX-1957).

**Out of the sample:**
- The Code Snob POCs #3310, #3321 and #3369, each folded into its parent by hand and closed
  unmerged. #3321 was opened by the review bot. #3317 took its shape and superseded it.
- #3281, a port of the red-main fix into another epic's branch.
- FIX-2002's PR, which belongs to FIX-1797's ledger.

**Endpoints and rounds.** Direction artifacts end at merge, as in cycles 21–23. In this project the owner's merge is the direction approval: none of the six carries a human approving review (the only approvals are Cursor's bot), so approval and merge are one event. Implementation
waves use cycle 22's mechanical count: distinct Codex-reviewed heads that drew at least one thread.
A PR with no Codex thread reads 0. Acted, declined and deferred come from each bot thread's last
reply, with the mailbox header stripped and the reply classed by its first word, as cycle 23 did.
*Agreed* followed by *can't settle* or *leaving this thread open* is deferred. Totals are thread
counts, comparable to cycles 22 and 23.

**Every act sits behind the shared `jhoffner` login**, so this entry doesn't say who merged what.

| PR | Kind | Rounds / waves | Endpoint | Acted · declined (· deferred) | Classes (findings) | Shape of the rework | Felt off? |
|---|---|---|---|---|---|---|---|
| [#3164](https://github.com/fixpoint-labs/flow-state-dev/pull/3164) epic FIX-1903 | epic | 1 | merge 10-12 18:23Z | 10 · 0 | spec-ambiguity 5 · missed-edge-case 3 · over-engineered 2 | Codex P1 ×2: a row naming a URL and a variable is a host-secret oracle (ER-14, aliases only); a checkout mapped from a row's remote is reachable by any owner (ER-13). D4's *Locks in* row carried the harness-held MCP connection that FIX-1905's owner review later reversed (see (e)) | no |
| [#3179](https://github.com/fixpoint-labs/flow-state-dev/pull/3179) amend: FSD holds MCP keys per user | epic (amend) | 1 (unread) | merge 10-12 20:04Z, **a minute before Codex and Cursor posted** | 0 · 0 (3 unanswered) | spec-ambiguity 3 · over-engineered 3 · nit 2 · stale-restatement 1 | **(d)**: Codex P2, the end-state figure's alt text still says the credential is host config. `stale-restatement`, **still on `main` at wrap** | no |
| [#3175](https://github.com/fixpoint-labs/flow-state-dev/pull/3175) spec FIX-1904 | spec | 1 | merge 10-12 19:39Z | 5 · 0 | nit 3 · over-engineered 2 · design-off 1 · missed-edge-case 1 · spec-ambiguity 1 | Codex P2: settle the SDK premise before approval. V1 ran in the spec phase (`poc/account-probe/`). Premise held, with one correction: no credential returns no source field, not `apiKeySource: "none"`. Architect coherence: one sign-in probe shared with FIX-1915 | no |
| [#3177](https://github.com/fixpoint-labs/flow-state-dev/pull/3177) spec FIX-1906 | spec | 1 | merge 10-12 20:04Z | 7 · 4 | over-engineered 3 · nit 3 · missed-edge-case 3 · stale-restatement 1 · design-off 1 · docs-miss 1 | Codex P1: a mapping keyed by `{ visibility, id }` matches another organization's project (BR-21, `{ orgId, id, tenantId? }`). Kill-line POC in the spec | no |
| [#3174](https://github.com/fixpoint-labs/flow-state-dev/pull/3174) spec FIX-1905 | spec | **2** (bots, then owner) | merge 10-13 20:45Z | 3 · 3 | over-engineered 5 · missed-edge-case 2 · nit 1 · spec-ambiguity 1, plus the owner's design-off | **(e)** round 2 was the **owner's design call**: FSD holds the MCP connection, each user sets their own key on Settings (*"We don't have a concept of admins"*). The rejected option was D2's own *considered and dropped* relay. Forced #3179 | yes (owner) |
| [#3198](https://github.com/fixpoint-labs/flow-state-dev/pull/3198) spec FIX-1927 | spec | 1 | merge 10-12 23:59:52Z, **4 min before Codex posted** | 2 · 2 (+ 2 notes, 3 Codex unanswered) | over-engineered 5 · missed-edge-case 3 · nit 2 · spec-ambiguity 1 | **(d)**: Codex P1, a run can rewrite the shared remote config and redirect the next run's fetch. That is #3201's r2–r7 tail, filed there as FIX-1934 | no |
| [#3185](https://github.com/fixpoint-labs/flow-state-dev/pull/3185) impl FIX-1906 | impl | 1 | merge 10-12 21:45Z | 2 · 4 | nit 3 · over-engineered 2 · missed-edge-case 1 · docs-miss 1 | Codex P1: changeset to one sentence. Cursor: a missing local `baseRef` becomes a workspace refusal. Second look: two config places must agree (`checkouts`, `localRepositories`), reconciled in #3194 | no |
| [#3189](https://github.com/fixpoint-labs/flow-state-dev/pull/3189) impl FIX-1904 1/2 | impl | 1 | merge 10-12 21:47Z | 2 · 5 | over-engineered 3 · nit 3 · missed-edge-case 2 | **(b)**: Codex P2, an empty or misspelled `GOAL_LEG` printed PASS with no evidence (FIX-1183's shape). P2: preflight the profile that will load. A registry race failed CI once (`ETARGET`) | no |
| [#3194](https://github.com/fixpoint-labs/flow-state-dev/pull/3194) impl FIX-1904 2/2 | impl | 1 | merge 10-12 23:37Z, **two Codex P1s open** | 1 · 2 · 2 | nit 3 · over-engineered 3 · missed-edge-case 1 · spec-ambiguity 1 | Codex P1 ×2: the real-model legs weren't run, and the signed-in-`HOME` path wasn't verified, because the builder had no Claude credential. Both deferred to *"someone with a sign-in"*, and #3205 ran leg b about an hour later | no |
| [#3205](https://github.com/fixpoint-labs/flow-state-dev/pull/3205) impl FIX-1904 follow-up | impl | 0 (**no bot review**; second look only) | merge 10-13 02:18Z | 0 · 0 | none | **(a)**: leg b FAILED (no project, then a slug goal, *"so Claude Code built the feature brief"*). Both were fixed in the EM's `WORKER.md`. Both causes came back at closure as FIX-1965 and FIX-1971 | no |
| [#3261](https://github.com/fixpoint-labs/flow-state-dev/pull/3261) impl FIX-1905 | impl | 1 | merge 10-13 23:22Z | 8 · 4 | nit 5 · missed-edge-case 4 · over-engineered 2 | Codex P1 ×3: MCP setup wasn't abortable; tool-call failures and short keys weren't scrubbed. P2: close a shared manager once. Two redaction copies were folded into `redactSecrets`. **(c)**: ported #3272's red-main fix | no |
| [#3308](https://github.com/fixpoint-labs/flow-state-dev/pull/3308) impl FIX-1965 | impl | 1 | merge 10-14 00:29Z | 2 · 0 (+ 2 notes) | nit 3 · docs-miss 2 · over-engineered 1 | Codex P1: rejecting non-object input is breaking, so the bump is `minor`. P2: document it. Code Snob #3310 folded | no |
| [#3299](https://github.com/fixpoint-labs/flow-state-dev/pull/3299) impl FIX-1966 | impl | 1 | merge 10-14 00:24Z | 5 · 2 | missed-edge-case 3 · over-engineered 2 · stale-restatement 1 · nit 1 | **(c)**: a stale DevTeam fixture after FIX-1920 and FIX-1872. Cursor: want exactly the delegated-post entry, not "anything but". Codex P2: a single-quoted import slipped the scan (red state checked) | no |
| [#3317](https://github.com/fixpoint-labs/flow-state-dev/pull/3317) impl FIX-1971 + FIX-1973 | impl | 0 (Codex: no major issues) | merge 10-14 17:24Z | 1 · 2 | nit 4 · over-engineered 2 | the profile replaces DevTeam's brief and commit-style skill by name. Code Snob POC #3321 folded. The class stays open: two more DevTeam fixtures still reach `fsd` runs (FIX-2013) | no |
| [#3367](https://github.com/fixpoint-labs/flow-state-dev/pull/3367) closure FIX-1919 + FIX-1991 | impl (closure) | 1 | merge 10-14 23:37Z | 14 · 2 | missed-edge-case 7 · over-engineered 3 · nit 3 | **(b)**: Codex and Greptile P1 ×2, the store moved outside the cleanup scope and the WAL sidecars lost; P2 commits graded from `HEAD`, not the base the run was cut from. FIX-1991's key-in-env fix was superseded on merge by FIX-2002 (same fault, another closure) | no |
| [#3199](https://github.com/fixpoint-labs/flow-state-dev/pull/3199) impl FIX-1926 | impl | 0 (Codex: no major issues) | merge 10-13 00:22Z | 0 · 5 | nit 3 · design-off 2 | the org becomes its own segment of a run's place, with a legacy bridge (`orgless`) for runs already on disk | no |
| [#3201](https://github.com/fixpoint-labs/flow-state-dev/pull/3201) impl FIX-1927 | impl | **9** | merge 10-13 02:18Z | 20 · 4 · 1 | missed-edge-case 17 · nit 6 · docs-miss 3 · design-off 1 · over-engineered 1 | **a run can write the repository its worktree shares**: r2 pin the ref and the SHA; r3 pins outside the shared repo, URL-rewrite race, immutable cut commit (**three findings open "fresh evidence beyond the earlier … fix"**); fix at r3: fetch in an isolated scratch repo and record `baseCommit`; r4 FIX-1934 filed; r5–r7 compare-and-swap, `--no-deref`, global gitconfig declined as the boundary; r8–r9 docs and cleanup. Spec #3198's unanswered P1 named this class | no |
| [#3272](https://github.com/fixpoint-labs/flow-state-dev/pull/3272) impl FIX-1957 | impl | 1 | merge 10-13 23:32Z | 1 · 2 | nit 4 · spec-ambiguity 1 · missed-edge-case 1 | Codex P2: the fix never reached the real feed (`Conversation` didn't pass `groupToolCalls`), so the tests proved a neighbour. **(c)**: carried the red-main fix for `main` | no |

**Load.** 17 waves over the 12 implementation artifacts (cycle 23: 29 over 12). #3201 carries
9 of them. Inside the epic, 7 waves over 9 PRs, and no in-epic PR took a second wave. About 56
acted threads in implementation and 27 in direction artifacts. One direction artifact took a second
round, and that round was the owner's design call (`design-off`, owner).

**Classes.** One finding, one class, read from each PR's reviews and inline threads (not issue
comments), so these are finding counts and don't sum to the thread counts above.
Implementation (105): `nit` 38 · `missed-edge-case` 36 · `over-engineered` 19 · `docs-miss` 6 ·
`design-off` 3 · `spec-ambiguity` 2 · `stale-restatement` 1. Without `nit`, `missed-edge-case`
leads at 36 of 67 (54%), and #3201 carries 17 of them. Direction (59, plus the owner's call):
`over-engineered` 20 · `missed-edge-case` 12 · `spec-ambiguity` 11 · `nit` 11 · `design-off` 2 ·
`stale-restatement` 2 · `docs-miss` 1. The #3179 `stale-restatement` is still unfixed.

**Claims (looped / settled / verdicts):** 0 / 0. Two spec-phase POCs ran before review asked
twice: FIX-1904's account probe (premise held, one field corrected) and FIX-1906's kill line.

**Reviewer exhaustion:** 0 of 6 direction artifacts had no Codex pass on any head (cycle 23: 8 of
9). Two of the six merged before that pass posted ((d)). Bugbot reported its usage limit on 11 of
the 12 implementation PRs. #3205 drew no bot review at all.
**Unread merged heads:** 10 of 12 merged implementation PRs had no Codex review of their merged
head (cycle 23: 9 of 12). #3199 and #3201 are the exceptions.

**Carried / not carried.** Cycle 23's fix commit `ea68a989` (10-11 18:37Z) is an ancestor of the
first head of every implementation PR here (`1f4d02c1`, `9f9b0bba`, `d8494a97`, `5d8df427`,
`e8380b03`, `d414f127`, `014f0ca3`, `04cc550a`, `877b4f46`, `90ed00b3`, `3ce6403e`, `b8846794`),
checked with `git merge-base --is-ancestor`. The whole sample carries it.

## (a) A prompt fix that left the cause in what the model was handed

| Cycle | Failure | First fix (a prompt) | What the model was actually handed | Came back as |
|---|---|---|---|---|
| 22 | the chief of staff left itself out of a member list | `WORKER.md`: *"list every member it gets back, itself included"* (#2768, two heads) | a thin `discover` that returned no members and no kinds | FIX-1785, hidden three days; the owner: *"prompting the chief of staff to list itself is a smell; this should be deterministic"* |
| 24 | the EM filed the coder's task with no project | EM `WORKER.md`: name the project (#3205 `d63a1849`) | `addTask`/`dispatchTask` declare `input: z.unknown()`, so nothing refused a missing or malformed project | FIX-1965 at closure: the chief of staff, on FIX-1872's new path, sent it as a JSON string and every run was refused. Fixed in the schema (`input` became an object, #3308) |
| 24 | Claude Code *"built the feature brief"* instead of the item | EM `WORKER.md`: keep the ask's details in the coder's goal (#3205 `0f15e00d`) | DevTeam's demo brief (`greet()` and a commit marker), which the `fsd` profile inherited as *"your team's standing contract"* | FIX-1971 at closure, with the marker in a real commit. Fixed by giving the profile its own brief (#3317). FIX-1973, then FIX-2013, found more of the same |

Each prompt fix was right on its own path: leg b passed. Each left the input that misled the model
in place, so the next path or the next model met it again. Tenet 5 already says this about code:
*"When a failure forces a workaround at the call site, the bug usually lives one layer down."*
Nobody reads a prompt as a call site, and an instruction that tells a model not to do what its
inputs invite is that workaround. Cycle 22 sharpened `goals/README.md` so a check grades the data,
not the retelling. That fixed how such a failure is *seen*. This fixes where it's *fixed*.

## The proposed upstream fix: one sentence, in tenet 5

| File | Now | Proposed |
|---|---|---|
| `docs/philosophy.md` · tenet 5, first paragraph | *"…A workaround every caller must copy is a smell."* | *"…A workaround every caller must copy is a smell. A prompt is a call site too: when the instruction is right and a model still does the wrong thing, fix what it was handed rather than adding instructions."* |

It adds no rule and no checklist. It names the layer the three fixes above missed: here, a schema that accepted the wrong shape (FIX-1965), a document written for another profile (FIX-1971), and a tool that returned too little (cycle 22's #2768). The examples stay in this entry so the apex clause stays short. A worker
following it on #3205 would have asked why `input` took a string and where *"the feature brief"*
came from, and both closure blockers sat one answer away.

## (b) The fifth closure whose checks were wrong

| Cycle | Closure | First-head finding |
|---|---|---|
| 19 | #2348 | controls matched by leg; a leg that never ran read green |
| 21 | #2709 | `GOAL_PART=bogus` printed PASS |
| 22 | #2781 | a child control accepted on any nonzero exit |
| 23 | #3045 → #3048 | any red passed; then `alsoRed` optional |
| 24 | #3367 (+ #3189's child goal) | store restored outside `finally`, WAL sidecars dropped, commits graded from a stale `main`, the check's own process held the key; and on #3189 an empty `GOAL_LEG` printed PASS |

#3189's finding is FIX-1183 word for word, on a child goal rather than the closure. The closure
faults were caught on the first read, as in every earlier cycle, and fixed in one wave. Two of them
were the same fault found twice (FIX-1991 here, FIX-2002 in FIX-1797's closure). Cycle 23 held that
this is code and scheduling (a shared grader in `goals/lib`, and FIX-1183), and that still holds.

## Candidates considered and dropped

- **(e) as a grounding change** (*FSD holds a run's connections and keys; a harness gets tools
  only*). One instance, and it's a product decision that binds the next epics (FIX-1986 brings
  Codex and Cursor onto the same path), not a reasoning lesson. It belongs in the project spec's
  decided-once list. Handed to the coordinator for the wrap's `project-agent` update.
- **(e) as a template line** (*a Locks in row that decides who owns something is a decision of
  its own*). One instance. The template already says *Locks in* is a consequence, and the
  ownership call was a consequence the author didn't see as a fork.
- **(d) as text.** `orchestration.md` → *Merging and amending a spec* step 3 already asks that
  *"an automated review has returned on the current head"*. On #3198 a Cursor review had returned
  before the merge. Whether to wait for a requested Codex pass is the merger's call, so it goes to
  the owner as an ask.
- **(c) as text.** Running the model-free goal sweep on `main` contradicts a deliberate
  `goals/README.md` stance (*"Goals are not CI specs"*). That's an owner call.
- **#3194 merged with two P1s deferred to someone with a credential.** The leg ran about an hour later
  on #3205. Fifth cycle running for *merged before the review's findings were fixed* (#2434, #2633,
  #3015, #3045, #3194). Owner merges, nothing lost. Hold.
- **#3272's fix that never reached the feed.** BP-003 and tenet 7 cover it, and Codex caught it on
  the first pass. One instance.
- **The #3201 tail** (r2–r7). The race trigger fired at r3 and FIX-1934 was filed at r4, which is
  what cycle 22's and 23's sentences ask. Scored below, not reopened.

## Job audit

The PR body lists every addition the batch made and the job each one does. Seven jobs grew. Three
are coherent: where a run's checkout comes from (J1), storing a user's own credential (J5), and
changing one setting on a project (J6). `audit-coherence` found a fold in the other four, each
where an addition met an entry no spec compared it against. **Filed, not proposed:**

- **FIX-2015** (J1b, counting a run's own commits): the closure check re-derives the base the run
  already recorded as `baseCommit`, and its first version got it wrong.
- **FIX-2014** (J2, checking a harness can run): Cursor's and Codex's sign-in checks live in
  Kitchen Sink app code, not their packages, and the Claude run environment is copied twice.
- **FIX-1986**, commented rather than filed again (J3, handing a run MCP tools): the
  harness-neutral relay type is defined in the claude-code package and re-declared in workforce.
- **FIX-2012** (J4, keeping a secret out of what leaves the server): two redaction rules disagree,
  so an MCP key under eight characters reaches Error Reporter issues.
- **FIX-2013** (J7, a profile's standing documents): the `fsd` profile still hands its workers the
  coder's `branch-naming` skill and the EM's demo handbook.

## Scoring the previous cycles' fixes and claims

- **Cycle 23's claim 1 (does the widened trigger name a crash-window primitive by round 3?): no
  crash-window tail reached a second round.** #3367's store and WAL window closed in its one
  round. The longest tail, #3201, is a shared-state race (a run writes the repository the next
  run reads). Its primitive was named at r3 (isolated fetch, recorded `baseCommit`), FIX-1934 was
  filed at r4, and the invariant's last finding was r7. Baseline: #2964, r3–r9, never named. All
  heads carry `ea68a989`.
- **Cycle 23's claim 2 (reopenings counted from the reviewer's marker): 5 findings, all on
  #3201** (r3 ×3, r5, r6). The r3 pair is where the trigger fired. Baseline: 12 over 9 rounds.
- **Cycle 23's claim 3 ((b) on the next closure): yes, the fifth in a row**, plus FIX-1183's own
  shape on #3189. No shared grader landed, and FIX-1183 is still Backlog.
- **Cycle 23's claim 4 (reviewer exhaustion on direction artifacts): 0 of 6 with no Codex pass**,
  down from 8 of 9. A new failure took its place: two of the six merged before the pass posted.
- **Cycle 22's sharpened `goals/README.md` technique 1 (grade the data, not the retelling):
  held.** #3367 grades git and the Lab's routes, and FIX-1904's goal grades stored rows and branches.
  (a) is the other half of the shape: where it gets fixed, not where it gets seen.

## Claims to test next cycle

1. **Does a model-backed failure get fixed at what the model was handed?** For each real-model
   check failure fixed during an epic, record whether the fix touched a prompt, a schema, data or a
   document, and whether the failure came back by closure. Baseline: 2 of 2 prompt fixes here
   came back.
2. **Is a direction artifact merged before a requested Codex pass posts?** Count them, and any
   P1 that pass raised afterwards. Baseline: 2 of 6, one P1 that became a 9-wave tail.
3. **(b) on the next closure,** and whether a shared control grader or FIX-1183 has landed.
   Baseline: five closures running.
4. **Closure finds caused by sibling merges.** Count closure blockers whose cause merged after the
   child's last passing check. Baseline: 2 of 5 (FIX-1965's path, FIX-1966's fixture).
