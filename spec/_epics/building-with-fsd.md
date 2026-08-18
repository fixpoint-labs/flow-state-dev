# Epic — Building with FSD: the first hour in someone else's project

## 1. Purpose & objective *(the gated sign-off surface)*

Someone who hears about FSD today cannot use it. The root README tells them to clone our
monorepo, run our tests, and read our reference app. There is no scaffold of any kind, so
putting FSD into a project they already have means copying files out of our repo by hand — and
the coding assistant they would normally lean on has nothing to go on, so it writes FSD-shaped
code that does not run. Public Launch is the reason this is now rather than later: everything
else in that project points people at a front door that is not there.

*Linear epic **FIX-1161** · Branch `epic/building-with-fsd` · Epic PR
[#1301](https://github.com/fixpoint-labs/flow-state-dev/pull/1301) (never merged) · Project
**Public Launch**.*

**Outcome.** Someone who has never used FSD gets a working AI feature streaming from a real
model inside their own project — new or existing — without cloning our repository or reading our
source; and the coding assistant they work with writes FSD code that runs rather than code that
merely looks right.

**What "getting there" costs them, stated exactly, because the Proof below is the precise
version and this line used to overclaim against it.** Greenfield is **one scaffolding command
plus the dev command it prints**. The scaffolder does not start the app and does not open a
browser — no comparable tool does (`create-next-app`, `create-vite` both stop at printed next
steps), and a command that leaves a server running behind a finished prompt is worse ergonomics,
not better. Brownfield is **one agent run the developer reviews before accepting**, which is a
diff review by construction and cannot be one unattended step. Neither path is "one step", and
the epic does not promise one.

**The two entry paths are different kinds of thing, and that is the epic's central call.**
Starting a new project is a command: one shape, no host to detect, nothing to merge. Adding FSD
to a repo that already exists is **agent work** — an install skill, not a command. The reason is
what three review rounds did to the deterministic version. It had to grow a separate branch for
each of: four different merge semantics across four files; CommonJS vs ESM config generation;
Node 22.0–22.17 vs 22.18+; `packageManager` field vs lockfile vs `npm_config_user_agent`; an
already-tracked `.env.local`; an existing `fsdev.config` orphaning the generated flow; an
existing `scripts.fsdev`; npm's option separator; `create-next-app` version drift; the bind
guard; a two-process filesystem-store race; provider SDK selection. Each was found by a
reviewer, one at a time, and there is no round at which they stop. That is the signature of a
command trying to **enumerate** the shape of every host repo. An agent does not enumerate — it
reads the repo in front of it, and the developer reviews the resulting diff before accepting
it, which is also strictly safer than a tool mutating their repo unattended. What stays
deterministic is **detection** (cheap, checkable, no merge logic) and the whole greenfield path.
Deterministic *mutation* is what goes. Carried by themes 1, 5, 6 and 8.

**Proof** — carried by the issues' own goal checks, no new measurement apparatus:

- *FIX-1159, mounted-route path* — a fresh `create-next-app` **on pnpm**, then an agent runs the
  install skill against it, then `fsdev run` returns a streamed model response from a real model,
  and a route that existed before the run still responds. **pnpm is load-bearing here, not
  incidental:** its strict isolation is the only thing in the epic that fails an undeclared direct
  dependency, and theme 9's dependency set is a rule rather than a list precisely because two
  review rounds each found a missing member. npm's flat `node_modules` would hoist them and let
  the run pass on an incomplete `package.json`. **Distinctive content is seeded before the
  run into each of the files a brownfield run touches in practice** — `package.json`,
  `.gitignore`, `.env.local`, `AGENTS.md` — and is still there afterwards; **and the run's own
  report is compared against the actual diff**, so a file it touched but did not name is a
  failure. A surviving route proves the app works, not that the run was additive, because that
  route sits outside everything the run edits. The report-versus-diff half is what replaces the
  fixed file list theme 6 used to carry, and it is the stronger of the two: it catches a file
  nobody thought to seed.
- *FIX-1159, second-process path* — the same skill run against an **existing plain-Node
  project**, seeded and checked the same way: the printed command starts FSD, a call to it
  returns a streamed model response, the project's own server still runs. **Theme 8 makes this
  a different shape, not the same check twice** — a different host, and a second process rather
  than a mounted route — so the Next.js run above does not cover it. **With the Node template
  cut (theme 2), this is the epic's only Node coverage of any kind**, which makes it load-bearing
  rather than merely non-redundant: without it, Node detection and the second-process instruction
  can be entirely broken while every other listed proof passes.
- *FIX-548* — in an empty directory, `npm create flow-state my-app` **followed by the dev command
  it prints** yields a streamed model response from the surface the template ships — the chat
  page. The provider key goes in at the prompt, the way a real user supplies it, rather than
  being pre-exported. Run once; there is one template. **And the same run asserts the additive
  guarantee on the greenfield side**, because theme 6 now binds this path too and a streaming
  chat page proves nothing about it: `create-next-app`'s own `AGENTS.md` block is still present
  alongside the appended FSD section, its `CLAUDE.md` is untouched, `.env.local` is actually
  ignored (`git check-ignore`, since that entry comes from the host scaffold and is asserted
  rather than added), and **the run's report is compared against the actual diff** — the same
  check the brownfield runs make, for the same reason. Without these, the scaffolder could
  overwrite an agent-instructions file it did not author, or leave a provider key untracked by
  `.gitignore`, and every other listed check would still pass.
- *FIX-1160* — one recorded run covering **both halves of the pack**: the Claude plugin
  installed from its published source and one of its packaged skills invoked, and then a coding
  assistant in a freshly scaffolded project, given a stated feature goal and nothing else,
  produces a flow that passes `fsdev run`. A single observation, stated as such, not a metric.
  **The plugin is inside the run because it is now the brownfield path's delivery channel**, not
  only an authoring aid — a check the scaffolded `AGENTS.md` satisfies on its own would pass
  while the plugin's manifest, install source, and packaged skills sat unexercised until a
  stranger tried them.

**Two of these are now agent runs, and that changes what they are worth.** A seeded-sentinel
check on an agent run is one observation, not a guarantee — the same shape FIX-1160's proof
always had. It is still the real path with a real model and no new apparatus, which is what a
goal check is for; it is not a claim that every brownfield repo behaves. The trade the owner
made is deliberate: an enumerating command gave stronger per-case guarantees over a case list
that never closed.

**Holistic necessity.** Four issues, and the split has moved which of them is load-bearing.
**FIX-1160 is now the substance it was not before.** It was kept defensively — it carried the
objective's second clause, and cutting it cut the objective in half. It now *ships the
brownfield path itself*: the install skill reaches a stranger's repo only through the plugin
FIX-1160 packages, so without it the epic has a greenfield command and nothing else.
**FIX-1159 remains essential but is no longer a command** — it authors the detection scripts,
the install skill's content, and the shared next-steps block, which is the knowledge the whole
brownfield path is made of. **FIX-548 is stronger than it was**: it is now the only
deterministic path to a running app, and the two-command alternative that used to undercut it
(`npx create-next-app && npx …init`) no longer exists, because there is no brownfield command
to run second. **The package-name half of the case against it is now settled** —
`create-flow-state` is unregistered and available (verified against `registry.npmjs.org`), so
the headline command is a name we can have rather than a hope. What is left of the case against
it is the saved command alone.

**One deterministic writer, one specified shape.** The old boundary — the wrapper owns demo
content, init owns scaffolding — existed to stop two deterministic writers duplicating
scaffolding logic. There is only one such writer now, so that line is gone and FIX-548 owns its
template end to end: host wiring, config, flows, demo content, the agent-instructions file.
The replacement tripwire is **drift**, and what both paths are held against is the **wiring
contract FIX-1159 authors** — not the template, which the brownfield skill can never reach
(theme 9). Writing the shape and specifying it are different jobs: FIX-548 writes it, FIX-1159
specifies it, and an instruction or template file that restates the wiring instead of citing it
is the signal.

**FIX-1162 (npm name registration) is a fourth issue but not a fourth workstream.** npm short
names are first-come and unrecoverable, and the objective promises a scaffolding command a
stranger can type — which needs a name we can publish under. It serves FIX-548's headline
command. **That name is settled: `create-flow-state`, invoked as `npm create flow-state
my-app`** — §4 records what it corrected. What remains open in FIX-1162 is larger and
separate: whether the `@flow-state-dev/` npm scope is ours at all.

**Not doing.**

- An authoring MCP server. Agent help reaches the developer through the file init-time work
  leaves in their repo and through the plugin — both of which the developer can read and the
  assistant loads without a running process. A server is a third surface that has to be alive,
  authenticated, and kept in step with the other two. *(This entry previously rested on "the
  CLI already carries the actions." It no longer does — the brownfield actions are a skill, not
  CLI code — so the conclusion is kept on reasoning that survives the split.)*
- A block / plugin / component registry (FIX-147 remains independent).
- **Any template beyond the Next.js chat app.** v1 ships one. The framework-neutral Node API
  template is cut — theme 2 records why, and adding it later is additive and strands nobody.
- Hosted or cloud onboarding, accounts, deploy buttons.
- The docs-site IA revamp, brand pass, and pre-launch docs sweep (FIX-601 / FIX-551 / FIX-550
  are separate Public Launch issues). This epic writes only the docs its own deliverables
  require.
- Editor-specific rules files beyond the one universal agent-instructions file.

**Kill line.** If the first cohort stalls *after* hello-world rather than before it — they get
a running app and then cannot reach their second feature — then setup was never the bottleneck
and the investment belongs in worked examples and concept guides. Concretely: if the people
asking for help are the ones who already have a running FSD app, finishing this is the wrong
call.

## 2. Themes & long-horizon direction

1. **Two entry paths, and they are different kinds of thing: greenfield is a deterministic
   command, brownfield is an agent skill.** `create-flow-state` (`npm create flow-state my-app`)
   starts from an empty directory — one shape, no host to detect, nothing to merge — and stays a
   command that owns its template end to end. Adding FSD to an existing repo is an **install
   skill**: the agent reads the repo
   in front of it instead of enumerating the repos it might meet, and the developer reviews the
   diff before accepting it. **Detection stays deterministic** — which package manager, App
   Router vs pages, whether a config already exists, whether `.env.local` is tracked — and
   ships as scripts the skill calls. **Deterministic *mutation* is what goes**; §1 records why.

   **Ownership (decided).** **FIX-548 owns the greenfield command and its template — it is the
   only command in the set.** FIX-1159 authors the detection scripts and the install skill's
   *content* and ships **no command of its own**; FIX-1160 packages and distributes it alongside
   the authoring skills. That is the same content-versus-delivery split those two issues already
   use for the agent-instructions file, with the roles assigned by which issue holds the
   knowledge: FIX-1159 knows what wiring FSD into an existing repo requires, FIX-1160 knows how
   to package and ship a Claude skill.

   **Both paths are held against one specified wiring shape — see theme 9, which owns it.** With
   one deterministic writer left, "no scaffolding logic in two places" has nothing to bite on. The
   live risk is drift between the shape FIX-548's template writes and the shape FIX-1159's
   instructions describe. This theme used to answer that by making the template the reference and
   having the skill point at it; the skill can never reach the template, so **theme 9 assigns the
   contract to FIX-1159 and makes the template conform to it** instead.

   **"Owns its template end to end" means checked-in files, not assembled at runtime** —
   confirming the reading FIX-548 took and asked about, because conformance only works under it: a
   template that exists only after a generator has run is one nobody can check the wiring contract
   against. So the config, the mount pair, the flow and the page are files in the repository.

   **Sequencing.** FIX-1159 lands before FIX-548, but for a narrower reason than before — the
   wrapper relationship is gone, and what remains is the shared next-steps block (theme 5) and the
   wiring contract the template conforms to (theme 9). The two still proceed in parallel further
   than they could, but not as far as the next-steps block alone would allow: theme 9 constrains
   the template's own files, not just what it prints. **FIX-1160 depends on FIX-1159** (it
   packages content that issue authors) **and now also lands before FIX-548**, which ships the
   agent-instructions content FIX-1160 authors (theme 9 (ii)) — so FIX-548 is last of the four.
   **FIX-1162 no longer gates FIX-548's
   spec or its build** — the name is chosen and available, so nothing is waiting on a decision.
   What it still gates is the *release*: `npm create flow-state` resolves only to an unscoped
   published `create-flow-state`, so that publish is a hard prerequisite, and it is an owner
   operation rather than agent work.

2. **One template: the Next.js chat app. The framework-neutral Node API template is cut.**
   This reverses the earlier "two templates, and only two"; the reversal is the owner's, and the
   argument is what the other decisions did to the Node template's contents. Once a plain-Node
   host gets no generated server entrypoint (theme 8) and no `fsdev` package script, the Node
   template's entire remaining delta over `npm init -y` is a `package.json`, a `tsconfig.json`
   and a better-named demo flow. The accepted cost that bought it — two starters to keep green
   on machines we do not control — did not shrink with it.

   **The deciding point is the asymmetry, not the file count.** Adding `node-api` later is
   additive and strands nobody; removing a published template later breaks invocations that
   exist. So the cheap direction is to ship one and add the second when something points
   backend developers at a Node starter by name.

   **What follows for the issues below.** FIX-548's proof runs once, not once per template.
   Whether v1 therefore ships no `--template` flag at all is FIX-548's call, not this
   document's — a flag with one legal value is a local design question. An issue that wants a
   second template has hit a cross-cutting question: comment up on this PR rather than adding
   it.

3. **Agent help is a file plus a plugin, never a server — and the plugin now carries the
   install path, not only authoring help.** A universal agent-instructions file lands in the
   consumer's project (written by the brownfield run, shipped in the greenfield template) and
   works with any coding assistant, plus an installable Claude Code plugin. That plugin now
   packages **two** kinds of skill: the authoring skills, and the **install skill that is the
   brownfield entry path itself** (theme 1). `packages/mcp` points outward — it exposes flows
   so other people's agents can call them — and is not an authoring aid; nothing in this epic
   changes that direction. **The plugin ships install-by-URL only at launch — no public
   directory listing** (§5 Q2, decided). That constraint is materially heavier than when it was
   decided, because it is now the only way a stranger reaches the brownfield path at all, so
   **§5 Q4 puts the consequence back to the owner**. **§1's proof runs through that channel.**
   **And the epic writes *Claude skills* / *the Claude plugin* wherever the packaged kind could
   be read as FSD's own runtime `skills`, which keeps the bare word** (§5 Q3, decided).

4. **Nothing this epic produces reads from our monorepo — at runtime or in an instruction.** A
   constraint the objective imposes, not a new call, and it binds all three workstreams: a
   template cannot carry `workspace:*` dependencies or a build script that reaches the repo
   root (which is why `apps/kitchen-sink` is not a template); the five build-with skills in
   `.agents/skills/` all hardcode monorepo paths today, so FIX-1160 packages rewritten **Claude
   skills** rather than copying those; and **the install skill's instructions must never tell an
   agent to copy files out of our repository**, which is the exact failure the objective names
   in its first paragraph.

5. **DevTool and CLI discovery is not its own workstream — it is a property both entry paths
   satisfy.** `@flow-state-dev/devtool` is an **optional peer** of `@flow-state-dev/cli`,
   satisfied inside this monorepo by a dev dependency and by nothing at all in a consumer's
   project — so outside our repo `fsdev dev` cannot resolve its assets and fails. The gap is
   therefore two things, not one: the DevTool has to be made **resolvable** as well as
   **known**. Greenfield satisfies it by declaring it in the template; the brownfield skill is
   instructed to add it, and detection reports whether it is already there. Neither becomes an
   issue of its own. **There is one next-steps block: one authored source in FIX-1159, shared as
   semantic content and rendered per package manager** — the same steps, in the same order,
   saying the same things, with the commands rendered for the manager the path is actually using.
   A second *authored* copy is how the two entry paths start telling people different things.

   **It is deliberately not byte-identical, and requiring that was a defect.** Greenfield prints
   `npm run dev` / `npx fsdev dev`; a brownfield run against a pnpm repo must print `pnpm dev` /
   `pnpm exec fsdev dev`, because detection found pnpm. A literally shared block is wrong for at
   least one supported context, and §3's own transcripts have always shown the two rendering
   differently — the word "verbatim" contradicted the document's own illustrations. What must
   not vary is the content: which servers exist, what each is for, which ports they land on, and
   the caveats that go with them.

   It sits with FIX-1159 because the constraint that makes it hard is the brownfield one:
   **a next-steps block must not print a command the project cannot run**, and greenfield can
   always run what it just wrote. That constraint is precisely why rendering has to vary and
   content must not.

6. **A run is additive over files it did not author, and what makes that safe is review of what
   actually changed — not an enumerated file list.** The old boundary was a fixed four files plus
   the lockfile, and §1 records why it kept growing. **What survives is the guarantee, not the
   list — and it binds both entry paths; only the enforcement differs.** Brownfield holds it as
   the skill's instruction, with detection reporting what it found and the developer reading the
   diff before accepting. Greenfield has no diff review, so it holds it in the template's
   checked-in contents and in the report the command prints — which is why §1's greenfield proof
   compares that report against the actual diff. The rules below are the same on both:

   - **Never overwrite a file it did not author, and never rewrite content it did not author.**
     Where a file already exists, add a delimited FSD section and leave everything else exactly
     as it was. That is what makes taking the shared `AGENTS.md` filename safe (§5 Q1).

     **The rule has exactly two exceptions, and they are enumerated here because a binding rule
     cannot have its exceptions living in §3, which binds nothing.** (This epic has made that
     mistake once already — theme 8 exists because a constraint sat in §3 unowned.)

     **(a) A stock placeholder the scaffolder itself just wrote, whose purpose is to be
     replaced.** `create-next-app` writes `app/page.tsx`; the greenfield template replaces it
     with the chat page, and that replacement *is* the deliverable — without it the command ends
     on a stock welcome screen. **The boundary is authorship and intent, not location:** a file
     the developer wrote is never replaceable, not even in a directory we created seconds ago.
     The neighbouring case proves the line is real — `create-next-app` writes `AGENTS.md` just as
     recently, and it is still **appended**, because its content is meant to persist (it carries
     its own delimited block, re-added on every `next dev`) and it is the file §5 Q1 chose for
     exactly that reason. Placeholder-meant-to-be-thrown-away is replaceable; content-meant-to-
     persist is not.

     **(b) Formats that cannot carry a delimiter.** `package.json` is JSON and has no comment
     syntax, so no delimited FSD section is possible — yet both the template and a brownfield run
     must add dependencies to it. There the invariant is **structural preservation**: change only
     the keys we own (the dependency entries, and `"type": "module"` where the template needs
     it), and leave every other key, every value, and the file's existing formatting as they
     were. Prefer delegation, which is the bullet below — the project's own package manager
     already does exactly this, which is why installing through it is required rather than
     merely tidy. Lockfiles are the extreme case and are never written directly at all.
     `tsconfig.json` is **not** in the edit set for the chosen template shape, so it needs no
     rule here; an issue that finds it does has hit a cross-cutting question.
   - **Refuse rather than write a credential into a tracked file.** If `.env.local` is already
     tracked, the run stops short of writing the key, says why, and tells the developer what to
     do instead. A provider key committed to version control is the one failure a diff review
     would not reliably catch, because it looks like every other appended line.
   - **Install through the project's own package manager, never write a lockfile directly.**
     Declaring dependencies is not the same as making them available, and theme 5 forbids
     printing a command the project cannot run — so a run installs, and the project's own tool
     rewrites the lockfile.
   - **Name every file it touched and say what happened to each** — the lockfile included. A
     repo with a frozen-lockfile CI job needs to see that coming, and a "nothing else was
     touched" line printed after appending to a tracked `AGENTS.md` is the failure this theme
     exists to prevent.

   **This is no longer a brownfield-only theme, and the correction matters more than it
   sounds.** It used to say greenfield "writes only new files into an empty directory, so it has
   nothing to be additive over." That is false. `create-next-app@16` writes its own `AGENTS.md`
   — with its own delimited block, re-added on every `next dev` run — and a `CLAUDE.md`, before
   our template lands. **So the greenfield Next path appends to an existing agent-instructions
   file; it never creates one.** Its `.gitignore` already carries `.env*`, which means the
   credential-ignore entry on that path comes from someone else's file and is a fact to assert,
   not assume. Measured, not reasoned: `spec-poc/FIX-548-next-template-shape/` on the FIX-548
   spec branch (`bash probe.sh`), which also confirmed an appended FSD section survives a
   `next dev` run intact. The guarantee is unchanged and better exercised — it now runs on both
   entry paths rather than one — and the file that made it look brownfield-only is exactly the
   file §5 Q1 chose.

   **§1's proof checks the guarantee two ways on both paths**, because an open boundary cannot
   be checked by asserting a closed list survived: seeded content in the files a run touches in
   practice, *and* the run's own report compared against the actual diff. **Extending this theme
   to greenfield extended its proof with it** — FIX-548's check asserts `create-next-app`'s
   `AGENTS.md` block, its `CLAUDE.md`, and the `.env.local` ignore survive the scaffold. A
   guarantee this document makes and no listed check exercises is worse than one it never made.

7. **No separate docs issue.** End-user functionality is documented in the change set that
   ships it — which now includes documenting the install skill as the brownfield path. The
   docs-site work named in §1's *Not doing* stays outside this epic.

8. **FSD arrives as a mounted route only where the host's conventions make the mount point
   knowable; everywhere else it arrives as a second process — and the run says which.** Next.js
   App Router gives a location that can be derived, so a brownfield run writes a real route into
   the existing app. A plain-Node project does not, and theme 6 forbids editing an entrypoint
   the run did not write, so there FSD runs as a separate process alongside the one already
   there, started by our own CLI rather than by a file generated into the customer's repo.
   Both are legitimate; what is not legitimate is leaving the developer to work out which they
   got. **Greenfield and brownfield must mean the same thing by "wire FSD into your project"** —
   the Next.js *template* and the brownfield Next path deliver the same mounted-route shape,
   described in the same words. This binds FIX-548 (what the template ships) and FIX-1159 (what
   the skill is instructed to do), which is why it is a theme rather than either issue's local
   call — and **theme 9 is where that shared shape is written down and who writes it**; this
   theme states the requirement, theme 9 assigns the artifact. **The Node half of that parity
   requirement is gone with the Node template (theme 2)**: the second-process shape now appears in
   exactly one place, the brownfield Node path, so there is no second description to keep in step
   — and §1's second-process proof is its only check, which is why that proof got harder to cut,
   not easier. **The move to a skill does not soften this into a per-run judgement call:** the
   agent reads the
   host, but the *rule* is fixed here, and detection reports which host it found rather than the
   agent re-deciding what "knowable" means each time. **§1's proof runs this path directly**,
   because the other checks cover the Next.js path only, and nothing else touches the brownfield
   Node behaviour this theme commits to.

9. **Content one issue owns and another ships needs a named author and an ordering edge. The
   split left two such artifacts with neither.** **The rule: one author, an explicit merge edge to
   whoever ships it, and the shipper consumes rather than re-authors.** Both instances below use
   it; neither needs a new package, a new dependency between packages, or a new artifact.

   **(i) The wiring contract — FIX-1159 authors it, FIX-548's template conforms.** Theme 1 used to
   make the template the reference shape and have the install skill point at it. The skill can
   never reach it: theme 4 forbids an instruction that reads our monorepo, a brownfield developer
   installs only the plugin, and the template ships inside the published scaffolder — neither in
   the plugin nor one of its artifacts. That left the skill to restate the template (the drift the
   tripwire exists to catch) or invent an unowned seam. It is FIX-1159's by theme 1's own rule,
   since "what wiring FSD into an existing repo requires" is the knowledge it holds; and because
   the contract is skill content, it travels the path skill content already travels — FIX-1159
   authors → FIX-1160 packages → the plugin ships. FIX-548 remains the set's only deterministic
   writer and still owns its template end to end: **writing the shape and specifying it are
   different jobs**, which is what the split required and what theme 1 had collapsed into one.

   **What the contract covers** — the part both paths genuinely share, which is smaller than the
   template (that carries a chat page and `flows/chat.ts` no brownfield run writes, and a
   plain-Node run writes no mount at all): the Next.js mount pair; `fsdev.config.ts`'s shape
   including its store profile; and the dependency set, which now has to name one thing it never
   did.

   **The dependency set is a rule, not a list: every package the generated files import directly
   is a direct dependency.** Two review rounds have each found one member missing, so the rule is
   what closes the class. **pnpm's strict isolation does not expose a dependency's own
   dependencies for direct import**, so "core already depends on it" never satisfies a consumer's
   `import`. Our own reference app already shows the shape — `examples/hello-chat` declares the
   `@flow-state-dev/*` packages, `zod` and `@ai-sdk/openai` as direct dependencies, and its flow
   opens `import { z } from "zod"` beside its `@flow-state-dev/core` import. Under the template as
   specified today the set is those three groups:

   - **`zod`.** The generated `chat.ts` / `hello.ts` need an input schema, and every public example
     imports `z` from `zod` directly. `@flow-state-dev/core` carries `zod` in its own
     `dependencies`, which does nothing for a consumer under pnpm. Without it the **pnpm brownfield
     proof fails while importing the generated flow** — before `fsdev run` reaches a model at all.
   - **The AI SDK package for the provider the prompt selected**, never a fixed one, because the
     prompt offers a choice: `openai` → `@ai-sdk/openai`, `anthropic` → `@ai-sdk/anthropic`,
     `google` → `@ai-sdk/google`. `@flow-state-dev/core` carries `@ai-sdk/openai` as a
     **devDependency only** (verified in `packages/core/package.json` — absent from `dependencies`
     and `peerDependencies`), and `createModelResolver` resolves provider packages from the
     consumer's own `node_modules`. With it absent the direct path is unavailable and there is no
     configured gateway to fall through to, so the first request throws `No provider available for
     "openai"`. A gateway key is the alternative the resolver accepts; choosing between them is the
     owning issues' call, shipping neither is not.

   **What makes the rule checkable: the proofs must run on pnpm.** §1's checks already fail on this
   class — an undeclared import fails at load, a missing provider package on the first request —
   but only under strict isolation. **npm hoists transitive packages into a flat `node_modules`, so
   a greenfield proof run with npm can pass with an incomplete `package.json`** and hide every
   member of this class. The brownfield pnpm run is what actually guards it.

   **(ii) The agent-instructions content — FIX-1160 authors it, FIX-548's template ships a copy,
   and a version marker catches drift.** §5 Q1 assigns the content to FIX-1160 and theme 3 has the
   template ship it, but no edge ordered them: in a merge order where FIX-548 lands first, the
   template ships an absent or copied draft that then drifts. **FIX-1160 lands before FIX-548** —
   but the ordering edge alone left *"consumes rather than re-authors"* undefined, because nothing
   said how the template obtains the content, and the alternatives were a duplicate that can drift,
   a build-time reach into another package, or a shared artifact.

   **Decided: the template checks in its own copy, and drift is caught rather than prevented.** The
   copy carries a **version marker inside the delimited FSD block theme 6 already requires** —
   `<!-- fsd:agent-instructions v<n> -->` — and a monorepo test asserts every shipped copy carries
   the marker FIX-1160 currently publishes. Change the canonical content without updating a
   shipper and CI fails, naming the stale copy. **FIX-1160 owns the canonical content, the marker,
   and the check; FIX-548 conforms.** No new artifact: the marker rides inside a delimiter this
   epic already mandates.

   **Why not a build-time copy, which is the obvious mechanism.** It presumes the two copies are
   byte-identical, and this epic has already been wrong about exactly that: theme 5 required the
   next-steps block be "reused verbatim" and **that was recorded as a defect**, because detection
   exists precisely so the printed commands match the host. The same pressure applies here — a
   template that just wrote `flows/chat.ts` can name it, a brownfield run against a stranger's repo
   cannot. **A marker check asserts currency, which is the property that actually matters, and it
   holds whether or not the two renderings are identical. A copy step asserts equality, which is a
   property we are not sure we want.** It also avoids the seam a copy would need: `create-flow-state`
   reaching into FIX-1160's source at build time, which undeclared is worse than declared, and
   declared is a new dependency between packages.

   **Every guarantee here has a check, which is the half theme 1's tripwire never had.** (i)'s
   wiring shape rests on **theme 8's parity requirement** — both paths deliver the same
   mounted-route shape. The dependency set rests on §1's proofs **run under pnpm**, since npm's
   hoisting hides the whole class. (ii) rests on the marker test. The tripwire that remains a
   judgement call is the authoring one: a template file or an instruction that restates shared
   content instead of citing it is the signal a person looks for in review.

   **Rejected — the plugin ships a copy of the template.** It makes FIX-1160 a second writer of the
   shape and needs the plugin's packaging to pull FIX-548's template, a build-time dependency
   between two deliverables that have none. **Also rejected:** the skill reading the published
   `create-flow-state` at run time (legal under theme 4 — npm is not our monorepo — but it makes
   the greenfield demo app the authority for brownfield wiring and never separates wiring from
   demo), and the shape from instructions alone, which *is* the restatement theme 1 forbids.

   **No new package and no new dependency between packages.** Had the answer needed either, it
   would have gone to the owner instead of into this theme.

## 3. Shape of the whole

**Built:** an end-state sketch, inline below — the file tree a developer ends up with from the
template, the file-tree diff a brownfield run produces against an existing Next.js app and
against an existing plain-Node app, and the terminal transcript of each path end to end.

**See it:** this section. Deliberately not a runnable POC: what this epic actually ships is
*what a developer sees and what files land in their repo*, and whether that is right is judged
by reading it. **Everything below is rough and illustrative** — names, wording, and layout are
the owning issues' to settle. Review the shape and the scoping it reveals, not the polish.

**Showed:** three things. First, drawn when there were two templates, the pair shared almost
nothing except `fsdev.config.ts`, `flows/`, `.env.local`, and the agent-instructions file. That
common set was originally the argument for a shared deterministic primitive. The split replaced
that primitive with the template itself as the reference shape (theme 1), and **that was the
wrong carrier — the brownfield skill can never reach the template, which is what theme 9 now
fixes** by making the shared shape a contract FIX-1159 authors. The original finding was sounder
than the answer it first got: what the paths share really is a small common set, and it is
smaller than the one surviving template (theme 2), which carries a chat page and a demo flow no
brownfield run writes. The division into issues holds, and the boundary moved rather than broke:
FIX-548 owns its template end to end, FIX-1159 owns the knowledge a brownfield run applies —
including the specification of the shape both produce.
Second, the next-steps block has to name **two** servers with different jobs (the app on its own
port, the DevTool on 4200); printing both without saying which is which is how a first-hour user
lands on a blank page, and both entry paths print it. Third, an asymmetry the prose hid: in a
Next.js app FSD can be mounted as a real route, because App Router conventions make the location
knowable, but in a plain-Node app nothing may edit an entrypoint it did not write — so FSD
arrives there as a **second process**, not an integrated route. That third finding is
**theme 8**, which is where it binds; it sat here as an observation with no owner until epic
review pointed out that §3 is explicitly non-binding.

**Changed:** originally added theme 5's second half (one next-steps block) and theme 6 (a
brownfield run is additive over what it touches). Both came out of drawing the diffs; neither
was visible in prose. Both survived the greenfield/brownfield split with their guarantees
intact and their mechanism changed — which is the clearest evidence that what the diffs
surfaced was a property of the *situation* rather than of the command that used to implement it.

### The template — Next.js chat app *(FIX-548, greenfield)*

`~` marks a file `create-next-app` wrote before our template lands, so the scaffolder never
creates it. **What happens to each differs, which is theme 6's point rather than an
inconsistency here:** `AGENTS.md` is appended to, `package.json` has only our own keys changed
(exception (b)), `app/page.tsx` is replaced (exception (a)), and `.gitignore` is asserted rather
than edited. None is overwritten wholesale — which is why theme 6's never-overwrite guarantee is
not a brownfield-only property.

```
my-app/
+   app/
+     api/flows/route.ts             the bare mount — serves list_flows on GET /
+     api/flows/[...path]/route.ts   createNextHandler(<default export of fsdev.config.ts>)
~     page.tsx                       chat UI, @flow-state-dev/react — replaces the stock page
      layout.tsx                     create-next-app's, untouched
+   flows/
+     chat.ts                        defineFlow — one action, one generator
+   fsdev.config.ts                  default-exports createFlowState({ flows, stores })
+   .env.local                       OPENAI_API_KEY=…
~   AGENTS.md                        create-next-app writes this first, with its own delimited
                                     block — the FSD section is APPENDED (§5 Q1, theme 6)
    CLAUDE.md                        create-next-app's, untouched
~   .gitignore                       already carries .env* — asserted, not added
~   package.json                     +next, react, @flow-state-dev/{core,engine,next,react,cli,devtool}
                                     zod, and the selected provider's SDK, e.g. @ai-sdk/openai
                                     — every package the generated files import (theme 9)
    next.config.ts                   create-next-app's, untouched
    tsconfig.json                    create-next-app's
```

*The mount is two files, not one: the engine registers `list_flows` as `GET /` on the mount
base and `client.listFlows()` requests it, while a required catch-all needs at least one
segment and would 404 there. Both in-repo mounts already pair the two, and the published
Next.js and Vercel guides teach the same shape.*

*Replacing `page.tsx` while appending to `AGENTS.md` is **theme 6 exception (a)**, not a local
call this sketch is making — the rule and its boundary live there, because §3 binds nothing.*

**The generated config declares a store profile, in the template and in what a brownfield run
writes.** `stores` is a required option and needs at least one named profile, so
`createFlowState({ flows })` alone does not typecheck and does not initialize — which would
block every command the next-steps block prints. Which profile ships, and how it is labelled as
a development default, is the owning issue's call.

### Diff — an install-skill run against an existing Next.js app

```
  my-existing-app/
+   app/api/flows/route.ts          the bare mount
+   app/api/flows/[...path]/route.ts
+   flows/hello.ts                  a runnable demo flow, so the next-steps block has something to run
+   fsdev.config.ts
~   AGENTS.md        +FSD section, delimited   (created if absent, appended if present)
~   package.json     deps +@flow-state-dev/{core,engine,next,react,cli,devtool}
                          + zod + the selected provider's SDK, e.g. @ai-sdk/openai
                            — every package the generated files import (theme 9)
~   .gitignore       +FSD ignore entries
~   .env.local       +OPENAI_API_KEY=   (created if absent, appended if present;
                                         REFUSED if the file is already tracked — theme 6)
~   pnpm-lock.yaml   rewritten by your package manager when the run installs (theme 6)
    app/api/billing/route.ts        untouched
    app/page.tsx                    untouched — the developer wrote it, so theme 6 exception (a)
                                    does not reach it (it reaches placeholders, not content)
    next.config.ts                  untouched
```

### Diff — an install-skill run against an existing plain-Node app

```
  my-existing-api/
+   flows/hello.ts
+   fsdev.config.ts
~   AGENTS.md                       +FSD section, delimited  (created if absent, appended if present)
~   package.json                    deps +@flow-state-dev/{core,engine,node,cli,devtool}
                                    + zod + the selected provider's SDK, e.g. @ai-sdk/openai
                                      — every package the generated files import (theme 9)
~   .gitignore                      +FSD ignore entries
~   .env.local                      +OPENAI_API_KEY=
~   package-lock.json               rewritten by your package manager when the run installs
    src/index.ts                    untouched — nothing edits an entrypoint it did not write
                                    (theme 8: so FSD arrives here as a second process)
```

*No server entrypoint is generated here either. FSD starts through our own CLI, which is where
the network bind guard and `.env` loading live — `serve()` in `@flow-state-dev/node` defaults
its host to all interfaces and reads no `.env` itself, so a generated three-line entrypoint
would expose the demo flow on the local network and then fail on a missing provider key. This
reasoning used to sit under the Node template; the template is cut (theme 2) and the reasoning
is not, because it is what makes the brownfield Node path a second process rather than a file
in someone else's repo.*

*Neither list is a boundary the way the old four-file list was. It is what these two repos
needed; another repo needs something else, which is the whole reason the brownfield path reads
the repo instead of enumerating cases. The guarantee is theme 6's, and the proof is the
report-versus-diff check in §1.*

### Transcript — greenfield

There is one template, so there is no template prompt and one transcript.

```
$ npm create flow-state my-app

? Model provider ›  OpenAI
? OPENAI_API_KEY ›  sk-••••••••

  Creating my-app with create-next-app …
  Writing the chat template …

  Created   app/api/flows/route.ts · app/api/flows/[...path]/route.ts
            flows/chat.ts · fsdev.config.ts
  Replaced  app/page.tsx   (create-next-app's stock page — theme 6 exception (a))
  Appended  AGENTS.md      (FSD section — create-next-app wrote this file)
  Wrote     .env.local     (already ignored by create-next-app's .gitignore)
  Changed   package.json   (dependency keys only — theme 6 exception (b))
  Installing dependencies … package-lock.json rewritten by npm

  Next steps

    cd my-app
    npm run dev        your app           → http://localhost:3000
    npx fsdev dev      the FSD DevTool    → http://localhost:4200
                       run flows, inspect traces, replay a request

    npx fsdev run chat send --input '{"userId":"u1","message":"hello"}'
                       run a flow from the terminal, no browser needed

  AGENTS.md tells your coding assistant how to write FSD flows.
  Docs: https://flow-state.dev/docs/getting-started
```

*The command stops here. It does not start the app and does not open a browser — the objective's
proof is this command **plus the `npm run dev` it printed**, which is where §1's Outcome was
corrected to match. The Node API transcript that used to follow is gone with the Node template
(theme 2); it printed `fsdev serve → http://localhost:8787`, and `fsdev serve` binds
`$HOST ?? 0.0.0.0` on `$PORT ?? 3000` — so it was wrong on the port, and wrong on the host in
the stronger sense that the CLI's bind guard refuses that host for an unauthenticated demo flow.*

### Transcript — the install skill, run against an existing Next.js app

```
> add FSD to this project

  Running FSD detection …

  Detected  Next.js 15 (App Router)  ·  package manager: pnpm  ·  no existing fsdev.config
            .env.local present and untracked  ·  AGENTS.md present (1.2 kB)
  Adapter   @flow-state-dev/next

? Model provider ›  OpenAI
? OPENAI_API_KEY ›  found in .env.local — using it

  I'll create   app/api/flows/route.ts   app/api/flows/[...path]/route.ts
                flows/hello.ts           fsdev.config.ts
  and append to .gitignore · AGENTS.md   (delimited FSD section, nothing else changed)
  and add dependencies to package.json    (only those keys — theme 6 exception (b))
  Installing with pnpm will rewrite pnpm-lock.yaml.

  Nothing already in those files will be changed. Review the diff before you accept it.

  [ diff shown · accepted ]

  Next steps

    pnpm dev             your app, now serving /api/flows/*  → http://localhost:3000
    pnpm exec fsdev dev  the FSD DevTool                     → http://localhost:4200

    pnpm exec fsdev run hello send --input '{"userId":"u1","message":"hi"}'

  AGENTS.md tells your coding assistant how to write FSD flows.
```

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| FIX-1159 | The brownfield knowledge — deterministic detection scripts, the install skill's **content**, the shared next-steps block, and **the wiring contract both entry paths satisfy** (theme 9) | spec | [#1310](https://github.com/fixpoint-labs/flow-state-dev/pull/1310) | — | In spec review — re-shaped against this fold to **brownfield only, no command of its own**; the earlier approval was retracted with the direction change |
| FIX-1162 | Register the npm names the launch needs — the short CLI entry name and the scaffolding name | spec | [#1313](https://github.com/fixpoint-labs/flow-state-dev/pull/1313) | — | In spec review — the npm operations themselves still sit with the owner |
| FIX-548 | `create-flow-state` — the deterministic greenfield path; **one** template (Next.js chat app), owned end to end | spec | [#1312](https://github.com/fixpoint-labs/flow-state-dev/pull/1312) | — | In spec review — re-drafted against this fold; no longer a wrapper over `fsdev init` |
| FIX-1160 | The authoring pack **and the plugin that distributes the install skill** — agent-instructions file, authoring skills, install skill | spec | [#1311](https://github.com/fixpoint-labs/flow-state-dev/pull/1311) | — | In spec review, **scope grew** — it is now the brownfield path's only delivery channel |

**The greenfield/brownfield split landed on top of two specs that were already written, and both
have since been re-drafted against it.** FIX-1159's spec described a deterministic `fsdev init`
that owned brownfield; its approval was retracted with the direction change and it is back in
spec review **scoped to brownfield only** — detection scripts, the install skill's content, and
the shared next-steps block, and **no command of its own**. The set's one greenfield command is
FIX-548's, per theme 1. FIX-548's spec was a thin wrapper over `fsdev init`; it now specs
`create-flow-state` writing the template as checked-in files.
That re-spec was this fold's largest downstream cost and it has been paid, not deferred. What
survived from FIX-1159's spec unchanged throughout is everything it *verified* about our own
packages (`serve()` binds all interfaces and reads no `.env`; the bare `/api/flows` is a real
endpoint needing its own file); those are facts about the code, not consequences of the command.

**Dependencies.** FIX-1160 depends on FIX-1159 — it packages content that issue authors.
FIX-1159 lands before FIX-548, for the shared next-steps block (theme 5) **and the wiring
contract the template conforms to (theme 9)** — a firmer edge than the next-steps block alone,
since it constrains the template's own files rather than what it prints. **FIX-1160 now also lands
before FIX-548** (theme 9): it authors the agent-instructions content the template ships, and
without that edge a template landing first ships a draft that then drifts. That makes FIX-548 the
last of the four, on a `FIX-1159 → FIX-1160 → FIX-548` critical path. **The
FIX-1162 → FIX-548 edge has narrowed but not gone**: the name no longer blocks speccing or
building, and the unscoped publish is still a hard prerequisite for release. None of these is an
accepted deferral; each is a real ordering constraint on merge, and each pair can be specced in
parallel. **The cut Node template is the one thing here that *is* a deferral** — it is not
blocked on anything and nothing starts when something else lands; v1 simply does not ship it.

**Folded this pass — the naming record, kept because two wrong names were in this document and
one of them is somebody else's package.** The scaffolder is **`create-flow-state`**, invoked as
`npm create flow-state my-app`. It replaces `create-fsdev-app` (a compromise adopted while the
short name was believed unobtainable) and, before that, `create-fsd-app`.
**`create-fsd-app` is not ours and never will be:** `create-fsd-app@1.1.2` is a React/Vite
starter published 2024-10-18 by an unrelated maintainer (`keyready`), verified against
`registry.npmjs.org`. Any sentence implying we hold or will hold it is false. `create-flow-state`
returns 404 — unregistered and available — which is the fact the choice rests on, and it is not
the same fact as owning it. Publishing unscoped is load-bearing rather than cosmetic:
`npm create <name>` resolves only to the unscoped `create-<name>`.

**Raised up but not folded here** — each belongs to a separate pass, and none is a gap in this
one:

- **Whether the `@flow-state-dev/` npm scope is ours at all** is untouched and is the larger
  half of FIX-1162's finding: nothing under it has ever been published, and an npm scope belongs
  to whoever registers the matching organization first. Two sibling specs lean on it as a safe
  fallback. Unlike the scaffolder name, this one is not settled by anything in this fold.
- **FIX-1160's POC established that Claude Code has no bare-URL plugin install** — the path is
  `plugin marketplace add <source>` then `plugin install`, so a marketplace manifest is a
  required distribution artifact rather than a public listing. Consistent with §5 Q2 as written;
  it sharpens Q4 rather than reopening Q2.

## 5. Open cross-cutting questions

Q1–Q3 are **decided** and stay here with their answers, so no issue reopens them. **Q4 is open**
and blocks nothing: it exists because the split changed what an already-made decision costs.

### ~~Q1 — What filename do the agent instructions go to, and what happens when one is already there?~~ — decided: `AGENTS.md`

*Raised while drawing §3's diffs; it touches all three workstreams (FIX-1160 authors the
content, FIX-1159's skill places it, FIX-548 ships it in the template), so no single issue can
settle it.*

**Plain terms.** Adding FSD to a stranger's repository drops in a file telling their coding
assistant how to write FSD code. `AGENTS.md` is the filename assistants already look for — and
it is also a filename many projects already have, holding instructions that have nothing to do
with us.

**The trade-off.** `AGENTS.md` gets picked up by every assistant with no configuration, and
risks landing on top of, or tangled into, a file the project already owns. A namespaced file
(`.fsd/agent-instructions.md`) can never collide, and is read by nobody unless the developer
wires it up — which is the same as not shipping it.

**My recommendation was: write `AGENTS.md`, and never overwrite.** If the file exists, append a
delimited FSD section and say so; if it does not, create it. Pickup is the whole point of the
objective's second clause, and a file nothing reads fails that clause silently rather than
loudly.

**Cost of being wrong.** Choosing `AGENTS.md` and being wrong is noisy and recoverable — a
developer sees a diff in a tracked file and deletes it. Choosing the namespaced file and being
wrong is quiet: FIX-1160 ships, nothing reads it, and the objective's second half is unproven
while looking done.

**Resolution — `AGENTS.md`.** Decided by the objective's first line: the outcome is that the
assistant beside the developer writes working FSD code, and a namespaced file nothing reads
fails that outcome by construction. **Collision risk is the cost of the objective, not an
alternative to it** — so it is managed, not avoided. **Behaviour required: append a delimited
FSD section, never overwrite, and leave any pre-existing content untouched.** That guarantee is
carried by **theme 6**; this entry is the record of why. The greenfield/brownfield split does
not touch it — the guarantee is now the skill's instruction rather than a command's code path,
and the filename is the same either way.

**One thing did change, and it strengthens the resolution.** This entry assumed the collision was
a brownfield problem and that greenfield would simply create the file. It will not:
`create-next-app` writes its own `AGENTS.md` before our template lands, so **both** entry paths
append (theme 6, measured on the FIX-548 POC). The append-never-overwrite behaviour is therefore
exercised on the path we control end to end, rather than only where a stranger's repo is
involved — which is a better place to find out it is wrong. **Closed — not reopenable by an
issue.**

### ~~Q2 — Is the Claude Code plugin publicly listed at launch, or install-by-URL only?~~ — decided: install-by-URL only

*Raised by the epic-spec against the verified state: there is no packaging or publishing path
for skills today — no `.claude-plugin/`, no marketplace manifest. It sets FIX-1160's scope and
touches the launch, so it is not FIX-1160's alone.*

**Plain terms.** The plugin can be installed from a source we publish and hand people, or listed
where Claude Code users browse for plugins. Listing puts our name in a public directory with an
implied promise that it keeps working.

**The trade-off.** A listing is discovery we cannot buy — people find FSD without us
introducing it. It is also a standing maintenance commitment on a surface we have never shipped
before, made in the same weeks as the launch itself. Install-by-URL costs nothing to maintain
and reaches only people already reading our docs.

**My recommendation: install-by-URL at launch, list afterwards.** The objective's proof is one
recorded run, not adoption; a listing does not make that run more likely to pass, and it adds a
public surface to a launch that already has several. Delisting later is worse than listing
later.

**Cost of being wrong.** Wrong on URL-only, and we leave discovery on the table for a few weeks
— fully recoverable. Wrong on listing, and we own a public entry we may not be ready to keep
green during the noisiest period we will have.

**Resolution — install-by-URL only at launch.** Decided by the product owner, on reasoning that
goes past the recommendation above: a public listing is a **support commitment in the week we
can least afford one**, and the asymmetry is what settles it — a listing is trivially added
afterwards, while delisting later reads as abandonment. No public directory listing during the
launch window. **FIX-1160 is scoped accordingly — the plugin still ships; only its distribution
channel is narrowed.** Because the channel is singular, **§1's proof runs through it**. Carried
by theme 3. **Closed — not reopenable by an issue**, but see **Q4**: the split has changed what
this decision costs, which only the owner can weigh.

### ~~Q3 — FSD ships a runtime concept called `skills`, and FIX-1160 ships Claude `skills`. Rename ours, rename theirs, or ship the collision?~~ — decided: no rename, qualify instead

*Raised by the epic-spec: the two words would sit on adjacent public docs pages, and FIX-417 /
FIX-424 own the existing one. It touches naming across the set, so it is not FIX-1160's alone.*

**Resolution — no rename, and the premise that the two are unrelated is rejected.** Both are the
same *kind* of thing — a packaged capability an agent loads — at different layers, so the shared
word is coherent rather than colliding, and this is not the incoherence case it was raised as.
The resolution is **qualification, not renaming**: write *Claude skills* or *the Claude plugin*
wherever ambiguity is genuinely possible, and let FSD's runtime concept keep the bare name
`skills`. **FIX-417 and FIX-424 are unaffected and must not be touched.** The split makes this
convention matter more, not less — the brownfield entry path is itself a Claude skill now, so
the word appears in more places. Carried by theme 3. **Closed — not reopenable by an issue.**

### Q4 — The plugin is no longer just authoring help; it is how brownfield reaches anyone. Does install-by-URL still hold? — **open, blocks nothing**

*Raised by the greenfield/brownfield split itself. It is not a reopening of Q2 — the decision
stands unless you move it — but the thing being decided changed underneath it, and only you can
price the new version.*

**Plain terms.** When you chose no public listing, the plugin carried authoring help: a stranger
who never found it still got a running app, just with a less useful assistant. After the split,
the plugin carries the **only way to add FSD to a project someone already has**. A stranger who
does not find it has no brownfield path at all — they can start a new project and nothing else.
In practice "install-by-URL" means our docs carry the source and they add it from there, so the
question is really: is our documentation a good enough front door for the epic's headline
capability during launch week?

**The trade-off.** Holding URL-only keeps the launch's public surface exactly as small as you
decided it should be, and the docs are where the launch sends people anyway — the install source
sits on the getting-started page and in the README. Listing puts the brownfield path where
people browse, and takes on the support commitment you declined, in the week you declined it
for.

**My recommendation: hold URL-only, and make the docs carry it properly.** Your asymmetry
argument survives the change — a listing is still trivially added afterwards and delisting still
reads as abandonment — and the launch's own traffic goes through the docs, so the channel is not
as narrow in practice as "URL-only" sounds. What I would add is a requirement rather than a
listing: the install source is on the getting-started page and in the root README, not only in
FIX-1160's own docs, so a stranger meets it on the first page they read.

**What would change my mind:** if the launch plan expects developers to arrive with an existing
repo *first* and read docs second — an announcement aimed at "add this to your app" rather than
"try this out" — then brownfield is the headline and burying its only channel one click deep is
the wrong call.

**Cost of being wrong.** Wrong on holding: the epic's most valuable capability is reachable only
by people who read far enough, during the weeks that matter most — recoverable, but the recovery
is a listing you did not want to own yet. Wrong on listing: a public entry to keep green in the
noisiest period we will have, which is the cost you already declined once.

---

## Epic evolution

One line per turn: what triggered it, what changed, why. The reasoning that still binds lives in
the themes and decisions above — it is not repeated here.

- **Epic drafted** — three issues under one outcome; scaffolder scoped to a thin wrapper over
  `fsdev init`, two templates accepted.
- **After the inline end-state sketch** — added theme 5's one-next-steps-block clause and theme 6
  (a run is additive over what it touches), because drawing the diffs showed what prose had not.
- **Q1 answered — `AGENTS.md`** — theme 6 took on the append-never-overwrite guarantee for it,
  since the spec recommended appending to a file theme 6 did not list.
- **After epic review** — added theme 8 (mounted route where derivable, second process otherwise),
  because §3 had surfaced the asymmetry in a section that binds nothing; corrected theme 5's
  premise (devtool is an *optional peer* of the CLI).
- **Q2 answered — install-by-URL only** — theme 3 took the plugin's distribution channel, so a
  child issue reads it in a theme rather than only in §5.
- **Q3 answered — no rename, qualify instead** — themes 3 and 4 write *Claude skills* for the
  packaged kind; FSD's runtime `skills` keeps the bare word.
- **Epic review, round 2** — theme 6's boundary named the lockfile; FIX-1162 added to the index.
- **Epic review, round 3** — §1's FIX-1160 proof now runs *through the plugin*, which §5 Q2 had
  just made the only channel.
- **Two convergence passes (not review rounds)** — FIX-548's demo-content scope, §1's existing-Node
  proof, the `.agents/skills/` path, the required store profile, and seeded sentinels in the files
  a brownfield run edits.
- **Owner direction change — brownfield becomes an agent skill, greenfield stays a command.** The
  deterministic init kept growing a branch per host shape with no round at which they stop, so
  detection stays deterministic and mutation goes. Themes 1, 5, 6 and 8 re-drafted; §1's proof
  gained the report-versus-diff check; new Q4.
- **Owner decisions folded — one template, and the name.** Node API template cut (theme 2); the
  scaffolder is `create-flow-state`; §1's Outcome stopped promising "one step"; theme 6 stopped
  being brownfield-only, since `create-next-app` writes its own `AGENTS.md`.
- **Epic review of that fold** — §1's greenfield proof now asserts the additive guarantee it had
  extended without checking, and theme 5's "verbatim" became one authored source rendered per
  package manager.
- **Epic review, round 2** — theme 6's two exceptions enumerated in theme 6 itself: a stock
  placeholder the scaffolder just wrote, and formats that cannot carry a delimiter.
- **Review of that fold** — §4's summary and index row corrected to FIX-1159 brownfield-only, and
  three surfaces that still described theme 6 as it read before its exceptions.
- **New theme 9 — shared content needs a named author and an ordering edge.** The split had
  severed the install skill from the shape it produces: FIX-1159 authors the wiring contract,
  FIX-548's template conforms.
- **Theme 9 generalized, and a P1 caught with it** — the provider SDK (`@ai-sdk/openai` and
  siblings) was in no dependency list though `@flow-state-dev/core` carries it only as a
  devDependency, so every real-model proof would have failed; and the agent-instructions content
  gained the same author-and-edge treatment (FIX-1160 before FIX-548). This section compressed to
  one line per turn.
