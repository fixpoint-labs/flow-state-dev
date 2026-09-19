# manager-queue-lab › it stands the team and its board up from files

**Issue:** FIX-1430 (the contract gate — S6 of the spec's Surfaces table, closing BR-1 to BR-3 and BR-8 to BR-17)

**Outcome:** Somebody writes a small tree of Markdown — one channel file whose frontmatter says `boards: [work]`, one coordinator and three builders — and points one call at it. The team has a place to keep its work, the coordinator holds the board without any file mentioning a board tool, a coordinator can say what is queued, running, waiting on a person and done, and none of that reading changes anything. A seat folder that tries to declare the board is refused by name, and the whole roster with it.

The ledger id is never written anywhere. It is minted from where the channel folder sits, which is the whole point: a file says a **name**, the framework owns the **identity**.

**Input:** `lab/workforce/` — one team `eng`, one channel `queue` declaring `boards: [work]` and four members, and four `WORKER.md` files naming two kinds. Held out: the channel's id, the board's local name, the desk keys, which seat answers for which desk and which seat runs which kind all come off the tree at run time. Rename the team folder, the channel folder, the board or a desk and a correct implementation still passes; every assertion is phrased against what the tree said.

**Signal:** ten legs, model-free, over a real `createFlowState` host with real sessions and real org-scoped storage.

(0) **The tree names a board and never an id.** Every file under `lab/` — the tree *and* the lab's own code — is read and searched for the minted id. A hit is a failure. This is the leg that makes the rest mean something: if a file could name the ledger directly, the later legs would pass for a seat that agreed with a string somebody typed.

(a) **The tree alone produces four seats, one channel and one ledger** (BR-1), and the ledger's id is minted from the channel's id and the board's local name. **Negative control:** point one seat's `flow:` at a kind nobody registered — the *whole* roster refuses and names that seat, so a refusal cannot leave a short roster running.

(b) **A seat folder that declares the board refuses the whole roster** (BR-3), asserted on the **block named**, never on the message's wording. Its corrected twin — the same tree without that file — hires cleanly. The seat-tool fence is not widened to let a board tool into a folder.

(c) **The eight task tools arrive by composition, and the fence never touches them** (BR-2). Three arms, read off *built* kinds rather than off a run: the coordinator with `tools: ["note"]` holds nine; the same kind fed **the `tools:` its own file declares** holds exactly the eight and the catalog tool is gone; a twin kind composing nothing holds none. Compared by tool **name**, since the instances are minted per resolver.

**What this leg does not grade, stated rather than implied.** The block is the one `openLab` built, so the *composition* is the shipped one — but the tools resolver is invoked **directly**, with a context the check assembles. It is not a live generation and says nothing about how the tools reach a model mid-run. The narrow claim is the one worth having: a seat's `tools:` can neither grant nor fence a capability control.

(d) **The channel's roster check on `author`, both arms** (BR-8). A filing naming a non-member is refused in the channel's own `author-not-a-member` words; the same call with **no** `author` lands. Both, or the rule reads as a membership gate the code does not have.

(e) **The queue is a read** (BR-10, BR-11, BR-12). The ledger is byte-identical either side of one; a blocked row appears under *waiting on you* carrying the reason it already had; a **real** claim on the substrate's 1000 ms minimum lease reads running with its seat busy, and once it lapses reads queued with its seat idle. Every row lands in exactly one column, and a row in none of them fails by name.

(f) **A lapsed row really is back in the queue** (BR-11), proved by the next drain taking it and running it — not by the old holder being stopped — **on the seat whose own file answers for the desk the row was filed for**. The two sides of that comparison are the row's `assignee` (a fact on the ledger, written by the filer) and the seat's own `answersFor` (read out of the tree from inside the run). Neither is the host's map, and that is load-bearing: comparing the seat's file against the map for *that same seat* puts the tree on both sides, and the leg cannot fail however badly the row was routed. It was written that way, `repointed-map` is the control that would have caught it, and it is the same defect this lab's own README names.

**An unclaimed settle by the coordinator is allowed** (BR-9), recorded as observed behaviour rather than defended as a design.

(g) **The task status set has exactly the members it had** (BR-13), asserted on the enum against a written-out list rather than against a reading of itself.

(h) **This issue's diff stays inside `goals/manager-queue-lab/`** and touches nothing under `goals/devforce-lab/` (BR-14, BR-15) — run against the merge base, not read off a list somebody maintained.

(i) **The drain-width switch runs WORK at either value** (BR-17), from one documented knob, with no edit to the tree and none to the checks. Each width files two rows for one desk, drains, and requires both to run and settle. Booting a lab at a width and reading the number back is not evidence that the lab runs at it — concurrency wiring ignored outright would leave that green — so the leg files and drains instead. The epic ruled width **1**; the knob stays because the ruling is reversible and because it is how the other case stays reachable.

**Anti-game:** A hollow pass would hire four seats, call a queue read, and assert it returned four columns — true even when the coordinator reached the board through a door nothing ships, true when the columns were stamped onto rows rather than derived, and true when the "lapsed lease" was a row this check wrote into the store. So the check MUST read the tool sets off **built kinds** with the seat's own `tools:` in place, since a count taken from a run with a live capability would be the same number under either door; MUST produce the lapsed lease by a **real claim left unrenewed**, not by writing a row, because a written row proves only that the view agrees with this file; MUST compare the ledger **before and after** a read rather than trusting that a view writes nothing; MUST assert the roster refusal on the **block named** rather than on wording the framework owns; MUST derive the diff claim from `git diff` rather than from an inventory; and MUST fail leg 0 if any file under the lab carries the minted id.

The `catalog-door` control is the other half of this. It leaves the tree untouched and perturbs only the wiring, so it has to fail at leg (c) rather than at leg 0 or at the hire.

**Model:** n/a — model-free on purpose. Nothing here is a judgment call: a roster hires or refuses, a kind holds a tool or does not, a column groups a row or does not, a ledger is byte-identical or is not. A model in the loop would add a way to fail that has nothing to do with the claim. The one thing that genuinely needs judgment is the sibling goal's.

**Run:** `pnpm tsx goals/manager-queue-lab/it-stands-the-team-and-its-board-up-from-files/run.mts`

**Controls**, and each one grades **itself**: a control that exits non-zero from a leg other than the one it names has demonstrated a different check, so each run ends by checking that every failure it collected belongs to its own leg, and says so loudly when one does not.

- `GOAL_CONTROL=catalog-door` — must FAIL, naming leg (c) and nothing else.
- `GOAL_CONTROL=repointed-map` — two builders' desks swapped in the host's map, the tree untouched. Must FAIL, naming leg (f)'s identity mismatch and nothing else. A **swap**, not a one-sided re-point: pointing one seat at another's desk while leaving the original there makes two seats eligible for it, and which one wins a concurrent claim is a CAS race — so the run could go red on the rows nobody was left eligible for, without ever emitting the identity mismatch the control exists to demonstrate.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-19 | fix/FIX-1430-manager-queue-lab (review round 1) | n/a | PASS | Four seats (`eng.builder-a`, `eng.builder-b`, `eng.builder-c`, `eng.manager`) on the two kinds their own files name; channel `eng.queue` declaring board `work`; the framework minted `eng.queue.work`, which appears in no file under the lab. The coordinator's file says `tools: []` and it held all eight anyway — `addTask_eng_queue_work` … `updateTask_eng_queue_work` — while `tools: ["note"]` held those eight plus the catalog tool, and the composition-less twin held none; read off the built kinds by invoking the resolver directly, not from a live generation. The refusal tree refused the whole roster naming `desk-board`; the corrected twin hired. The channel refused `author: eng.nobody` and accepted the same call with no author. A queue read left the ledger byte-identical; a blocked row carried its own reason; a 1000 ms claim read running/busy and, once lapsed, queued/idle, and the next drain took it back and ran it on the seat whose own file answers for the desk **the row was filed for**. An unclaimed settle by the coordinator: allowed. Status set unchanged at 7. Diff gate: 23 paths against `4fae24581`, all inside `goals/manager-queue-lab/`. The switch **ran two rows** at width 1 and at width 2. |
| 2026-09-19 | fix/FIX-1430-manager-queue-lab (control: `catalog-door`) | n/a | FAIL (expected) | Named **leg (c)** and nothing else: *"the coordinator whose file says `tools: []` holds 0 board tools, not 8: (none)"*. With the eight registered in the lab's own catalog instead of composed, the tree still loaded, the roster still hired, the ledger was still minted and every other leg still passed — only the door moved. The control's own self-check raised nothing, so the red is at the leg it names. |
| 2026-09-19 | fix/FIX-1430-manager-queue-lab (control: `repointed-map`) | n/a | FAIL (expected) | Named **leg (f)** and nothing else: *"the recovered row was filed for \"desk-two\" and ran on eng.builder-a, whose own file answers for \"desk-one\""*. **This control is new, and it is the red state leg (f) previously had none of.** Before this round the leg compared the running seat's own file against `lab.assignees` for that same seat — both derived from the tree, the row absent from the expression entirely — so it graded the wiring rather than the routing. The comparison now has the row on one side. |
