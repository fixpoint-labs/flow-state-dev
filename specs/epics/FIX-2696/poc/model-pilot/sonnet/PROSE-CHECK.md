# docs-editor review: compare/z

Pages: what-flow-state-is.md, tasks-and-boards.md, workers.md, plus figures/. Checked against
docs/contributing/user-docs.md (tells table, then voice). Figures checked against the drawing classes in
labs/design-system/page.css (imported by apps/docs/src/css/custom.css) and the existing figures under
apps/docs/docs/*/*.svg.

Mechanical sweep: zero em-dashes on all three pages and in the figures. No diff-narrative words
(*now*, *no longer*, *anymore*, *not just*). The one *still* (tasks:89) is not diff narrative. What
remains is mostly about level: two of the three pages slide into Reference material halfway through.

---

## what-flow-state-is.md: REVISE (4 findings)

1. what-flow-state-is.md:47 and :50, wrong level (edge-case rules in an overview)
   Quote: "A file in that folder the kit can't use stops the app from starting, with the file named." / "the app can list kits in any order. What kits put in a slot is merged and checked: a key supplied twice is refused, naming both kits."
   Why: this is the first page a newcomer reads. Startup validation, ordering and duplicate-key refusal are rules for someone writing a kit, not for someone learning what a kit is.
   Fix: cut both from this page and move them to the kit Reference page. Keep "A kit lists the kits it needs with `requires`."

2. what-flow-state-is.md:48 and :50, design defense / unobservable claim
   Quote: "workforce never learns that `harnesses` exists." / "so features build on each other without knowing about each other."
   Why: the page argues for decoupling twice, and a reader can't observe what one kit "knows". What the reader can use is that kits stay independent: you add or remove `harnesses` and leave workforce alone.
   Fix: "Remove `harnesses` and workforce runs without the coding worker. Neither kit's config changes." Keep it only if that is true. Otherwise cut both clauses.

3. what-flow-state-is.md:46 and :69, terms used before they are introduced
   Quote: "Its resources, views and capabilities ride on those flows." / "the items it produced"
   Why: four framework terms (resources, views, capabilities, items) appear without a definition, and "ride on" is vague. A reader can't act on this line.
   Fix: cut line 46's second sentence. At :69, say "the messages and results it produced".

4. what-flow-state-is.md:19, :113, figure footer, and frontmatter description, repetition
   Quote: "You work from the top and stop as soon as the change you want is made." / "Start with the first line that fits and go down only when it doesn't." / "Go down only as far as the change needs."
   Why: the page states "go top-down, stop early" four times, so by the fourth time it reads as a slogan.
   Fix: keep :113 (where the list makes it actionable). Cut the second sentence at :19 and the sentence in the figure footer.

Taste, not counted: :13 "Most agent frameworks hand you parts. Flow State hands you an app." works as an opener but sits close to landing copy. :99 "a model whose possible answers you know" reads as though you know the model's answers. Consider "asks a model a question with a fixed set of answers".

## tasks-and-boards.md: REVISE (6 findings)

1. tasks-and-boards.md:73, mechanism as reassurance
   Quote: "The claim is a single atomic write, so two assignees never run the same task: one wins and the other moves on to the next."
   Why: this is the tell from the table almost word for word. The reader needs the guarantee, not the write.
   Fix: "Two assignees never run the same task."

2. tasks-and-boards.md:75, wrong level (mechanism and edge rules)
   Quote: "The claim carries a lease, two minutes by default, which the board renews while the work runs. If the process dies, the renewals stop, the lease lapses, and the next claim takes the task back. A task taken back this way is not charged against its failure retries."
   Why: leases, renewals and retry accounting belong in Reference. The concept the reader needs is a single line.
   Fix: "If the process running a task dies, the task goes back to `pending` and runs again, without using up a retry." Move the lease details to the task-board Reference page.

3. tasks-and-boards.md:89–93, wrong level (two hold tools, routing rules)
   Quote: "A worker can also ask midway with `holdTaskForUser`. The turn ends, the task keeps its attempt and its work so far, and the person's answer starts one more turn on the same attempt." / "A run can stop with `suspendForUser`…" / "which answers its oldest open question."
   Why: a newcomer gets two similarly named tools with no way to tell which to use. Attempt bookkeeping and "oldest open question" routing are Reference detail. "Turn" is never defined.
   Fix: keep the three bullet heads, one plain sentence each: held, waiting on a person's answer, waiting on an approval. Link the tool names and answer routing to Reference. If both tools stay, say in one clause when you would pick each.

4. tasks-and-boards.md:27, wrong level / inaccurate verb
   Quote: "A model files them too, through four task tools: `createTask`, `getTask`, `listTasks` and `updateTask`. A fifth, `reportProgress`, is offered only to the turn that is working a task."
   Why: a tool inventory belongs in Reference, and `getTask`/`listTasks` don't file anything.
   Fix: "A model can file and update tasks too, through task tools you give it." Link the tool list.

5. tasks-and-boards.md:69, counted preamble
   Quote: "A task is always in one of six statuses."
   Why: a count announced before the figure. The figure shows the statuses.
   Fix: cut, or "A task's status is one of `held`, `pending`, `in_progress`, `completed`, `errored`, `cancelled`."

6. tasks-and-boards.md:97, unexplained terms
   Quote: "`all-completed`, `blocked-by-failures`, `waiting-on-a-user` or `retry-budget-exhausted`. `onIdle: \"wait\"` keeps a board open … until a predicate you supply says stop."
   Why: `retry-budget-exhausted` appears nowhere else on the page, and `onIdle`/predicate is configuration detail. The first sentence repeats :15.
   Fix: "It reports why it stopped." Link the reason list and `onIdle` to Reference.

Taste, not counted: :83 "never starts with a hole where competitor B should be" echoes the defect-narrative example in the tells table. "…the writer is cancelled instead of starting without B" states the same behavior flat. :103 "Declare a collection" uses "collection" without introducing it.

## workers.md: REVISE (5 findings)

1. workers.md:72–87, wrong level (refusal rules, client semantics)
   Quote: "A bad setting, a taken id, or the id of a standard worker is refused, and nothing is written." / "A `reset` deletes your copy…" / "`send` returns when the write starts, so wait for it to settle…" / the `forked.wait()` block / `watchRoster`
   Why: the verb list works as a concept. Refusal cases, `reset`, the send/settle split and roster watching are Reference or guide material. The newcomer gets an API manual halfway through a concept page.
   Fix: keep one sentence per verb, saying what it does. Move the refusal rules, `reset`, the settle example and `watchRoster` to the roster Reference page.

2. workers.md:19 vs :67 (and workers.svg:13/28), inconsistent ids
   Quote: "its id is `<team>.<name>`" / `ensureWorkerSession({ worker: "engineering.researcher" })` / `fork", { from: "researcher", …`
   Why: the page sets up team-qualified ids, then forks by the bare name, and the figure does the same. The reader can't tell which form to pass.
   Fix: use one form throughout. If both are accepted, say so in one clause. (Also listed under suspected inaccuracies.)

3. workers.md:46, contradiction until line 54
   Quote: "A worker belongs to one user."
   Why: a few lines later, "Every user has it" for standard workers. The reader trips here before the resolution arrives.
   Fix: "Each user has their own copy of every worker, standard ones included." Or move the Alice/Bob example up to this point.

4. workers.md:54, garbled sentence
   Quote: "Alice's answers for Alice, and Bob can't read what it remembers about her."
   Why: on first read, "Alice's answers" parses as a noun phrase.
   Fix: "Alice's researcher works for Alice, and Bob can't read what it remembers about her."

5. workers.md:91 and :93, unobservable claim / edge rule
   Quote: "every hand-over is checked against that roster" / "A coordinator is the worker built for it." / "A task whose worker was fired before it ran fails, and whoever filed it hears so."
   Why: "checked" says neither what is checked nor what the reader sees when the check fails. "Built for it" has no clear referent. The fired-worker rule is Reference detail, and "hears so" is vague.
   Fix: "A worker can only hand work to workers on its own roster." "A **coordinator** is a worker whose job is handing out work: it picks a delegate…" Cut :93 or move it to Reference.

Taste, not counted: :15 "rosters" before the term is introduced. :34 `fsd` appears without saying it is the client. :72 "on any process" is close to mechanism; "with no restart" covers it.

## Figures: consistency with each other and with the site

These are attached to the page verdicts above, not verdicts of their own.

- **workers.svg:19, :58–59, hatch means something else here.** On every existing site figure (fundamentals/state-scopes.svg, flow-type-instance-session.svg, getting-started/first-flow-homes.svg, glossary/workforce.svg, orchestration/task-board-parts.svg…), hatch's legend is "OUTLIVES THE REQUEST". Here it means "LIVES IN A USER'S DATA". Standard workers outlive the request as well, so a reader who knows the convention reads this wrong. Fix: drop the hatch, and let the column labels carry the distinction, or use a plain `.hs` boundary.
- **task-lifecycle.svg:43–45, dashed means something else here.** page.css defines dashed as "for what does not last", and task-board-parts.svg uses it as "ENDS WITH THE RUN". Here dashed means "from any open status". Fix: draw cancel as solid `.ln` and put "CANCEL · FROM ANY OPEN STATUS" on the plate.
- **task-lifecycle.svg:49–57, notes band repeats the leaked mechanism.** "A claim is one atomic write. It carries a lease, two minutes by default…" restates prose finding tasks 1–2 inside the drawing. The bullets also use "·" where every site figure numbers its notes `01`, `02` in `.n`. The `in_progress` subtitle "claimed, leased" carries the same mechanism. Fix: cut note 1 and replace "claimed, leased" with "being worked". Number the remaining notes 01–03.
- **layers.svg:17–18, the highlighter's only use on the site.** No existing figure uses `.hl`. page.css reserves it for "the figure's one focus", but Kits is not this page's focus: the page is about all four layers and moving top-down. Fix: remove the highlight, or move it to Layer 01 if the point is "start here".
- **layers.svg vs glossary/layers.svg, two "layer" stacks.** The site's existing figure numbers package layers (LAYER 04 = Hosts and stores, LAYER 05 = Shift Manager). This one numbers LAYER 01–04 as App/Kits/Flows/Blocks, so a reader who sees both meets two different "LAYER 04"s. Fix: drop the "LAYER 0n" labels here, since the names carry the order, or align with the glossary's numbering.
- **layers.svg:76, legend form.** Every site figure gives its legend as an arrow sample plus a `.lb` label ("IS MADE OF"), but this one writes a prose sentence in `.sub`. Fix: use the arrow-plus-label form.
- **layers.svg:5, vocabulary.** "THE PRODUCT" is the only place the stack is called a product. The page calls it an app. Fix: "AN APP" or cut the label.
- **workers.svg:49–50, repeated line.** "one shared copy" and "Every worker on it uses the same copy." say the same thing. Fix: cut :50.

Apart from these, the three figures agree with each other: same viewBox origin and width, the same arrowhead, plates on paper ground, and red only on errored/cancelled (an allowed use of red as an exception).

---

## SUSPECTED INACCURACIES

- workers.md:67, workers.svg:28: fork uses `from: "researcher"`, but the page says ids are `<team>.<name>` and the session call uses `engineering.researcher`. Verify which form the roster accepts.
- tasks-and-boards.md:90 vs task-lifecycle.svg:57: the prose groups `holdTaskForUser` with `questions` (which stay `pending`). The figure note says asked-midway tasks stay `in_progress`. Verify the status, and make the prose and figure agree.
- layers.svg:27: "harnesses: fills, then opens". The prose never says `harnesses` declares slots of its own. Verify, or change the subtitle to "fills a slot".
- tasks-and-boards.md:93: "the next drain after the answer picks up whatever depends on it". :101 says adding a task wakes nothing. Verify whether an answer starts a drain or waits for one.

## OFFERED CONTEXT DECLINED

- None was offered. Reads were limited to the z/ pages and figures, docs/contributing/user-docs.md, the drawing classes in labs/design-system/page.css (via apps/docs/src/css/custom.css), and existing apps/docs figure SVGs for the site's drawing conventions.
