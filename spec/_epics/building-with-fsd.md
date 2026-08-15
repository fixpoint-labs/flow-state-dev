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
model inside their own project — new or existing — in one step, without cloning our repository
or reading our source; and the coding assistant they work with writes FSD code that runs rather
than code that merely looks right.

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

- *FIX-1159, mounted-route path* — a fresh `create-next-app`, then an agent runs the install
  skill against it, then `fsdev run` returns a streamed model response from a real model, and a
  route that existed before the run still responds. **Distinctive content is seeded before the
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
  than a mounted route — so the Next.js run above does not cover it, and FIX-548's Node run
  exercises the *template* rather than a repo that already exists. Without this one, Node
  detection and the second-process instruction can be entirely broken while every other listed
  proof passes.
- *FIX-548* — in an empty directory, the npx command followed by the printed dev command yields
  a streamed model response **from the surface that template ships** — the chat page for
  Next.js, the API for Node. The provider key goes in at the prompt, the way a real user
  supplies it, rather than being pre-exported. Run once per template.
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
to run second. What is left of the case against it is the saved command and the package name.

**One deterministic writer, one reference shape.** The old boundary — the wrapper owns demo
content, init owns scaffolding — existed to stop two deterministic writers duplicating
scaffolding logic. There is only one such writer now, so that line is gone and FIX-548 owns its
templates end to end: host wiring, config, flows, demo content, the agent-instructions file.
The replacement tripwire is **drift**: the template is the reference shape, and the install
skill's instructions point at it rather than restating its contents (theme 1).

**FIX-1162 (npm name registration) is a fourth issue but not a fourth workstream.** npm short
names are first-come and unrecoverable, and the objective promises a single step — which needs
a name we own. It serves FIX-548's headline command; see §4 for a correction its own spec has
raised and this document has not yet folded.

**Not doing.**

- An authoring MCP server. Agent help reaches the developer through the file init-time work
  leaves in their repo and through the plugin — both of which the developer can read and the
  assistant loads without a running process. A server is a third surface that has to be alive,
  authenticated, and kept in step with the other two. *(This entry previously rested on "the
  CLI already carries the actions." It no longer does — the brownfield actions are a skill, not
  CLI code — so the conclusion is kept on reasoning that survives the split.)*
- A block / plugin / component registry (FIX-147 remains independent).
- Any template beyond the two agreed.
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
   command, brownfield is an agent skill.** `create-fsdev-app` starts from an empty directory —
   one shape, no host to detect, nothing to merge — and stays a command that owns its templates
   end to end. Adding FSD to an existing repo is an **install skill**: the agent reads the repo
   in front of it instead of enumerating the repos it might meet, and the developer reviews the
   diff before accepting it. **Detection stays deterministic** — which package manager, App
   Router vs pages, whether a config already exists, whether `.env.local` is tracked — and
   ships as scripts the skill calls. **Deterministic *mutation* is what goes**; §1 records why.

   **Ownership (decided).** FIX-1159 authors the detection scripts and the install skill's
   *content*; FIX-1160 packages and distributes it alongside the authoring skills. That is the
   same content-versus-delivery split those two issues already use for the agent-instructions
   file, with the roles assigned by which issue holds the knowledge: FIX-1159 knows what wiring
   FSD into an existing repo requires, FIX-1160 knows how to package and ship a Claude skill.

   **The template is the reference shape; the skill's instructions point at it rather than
   restating it.** With one deterministic writer left, "no scaffolding logic in two places" has
   nothing to bite on. The live risk is drift between the shape FIX-548's template writes and
   the shape FIX-1159's instructions describe. An instruction that restates the template's
   contents instead of pointing at them is the signal.

   **Sequencing.** FIX-1159 lands before FIX-548, but for a narrower reason than before — the
   wrapper relationship is gone, and what remains is the shared next-steps block (theme 5), so
   the two can now proceed in parallel further than they could. **FIX-1160 now depends on
   FIX-1159**: it packages content that issue authors. FIX-1162 gates FIX-548's headline
   command; see §4 for a pending correction to that.

2. **Two templates, and only two: a Next.js chat app and a framework-neutral Node API.** The
   accepted cost is two starters to keep green on machines we do not control, which is why
   FIX-548's proof runs once per template rather than once. An issue that wants a third
   template has hit a cross-cutting question — comment up on this PR rather than adding it.
   *(FIX-548's spec has raised the opposite case — dropping the Node template — and it is
   recorded in §4 as raised, not folded.)*

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
   issue of its own. **There is one next-steps block, authored once in FIX-1159 and reused
   verbatim by FIX-548 and by the skill** — a second copy is how the two entry paths start
   telling people different things. It sits with FIX-1159 because the constraint that makes it
   hard is the brownfield one: **a next-steps block must not print a command the project cannot
   run**, and greenfield can always run what it just wrote.

6. **A brownfield run is additive, and the developer's diff review — not an enumerated file
   list — is what makes it safe.** This is a brownfield theme: greenfield writes only new files
   into an empty directory, so it has nothing to be additive over. The old boundary was a fixed
   four files plus the lockfile, and §1 records why it kept growing. **What survives is the
   guarantee, not the list.** The skill is instructed to hold it, detection reports what it
   found, and the developer reads the diff before accepting it:

   - **Never overwrite a file it did not write, and never rewrite content it did not author.**
     Where a file already exists, add a delimited FSD section and leave everything else exactly
     as it was. That is what makes taking the shared `AGENTS.md` filename safe (§5 Q1).
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

   **§1's proof checks the guarantee two ways**, because an open boundary cannot be checked by
   asserting a closed list survived: seeded content in the files a brownfield run touches in
   practice, *and* the run's own report compared against the actual diff.

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
   the Node *template* and the brownfield Node path deliver the same process model, described in
   the same words. This binds FIX-548 (what the template ships) and FIX-1159 (what the skill is
   instructed to do), which is why it is a theme rather than either issue's local call. **The
   move to a skill does not soften this into a per-run judgement call:** the agent reads the
   host, but the *rule* is fixed here, and detection reports which host it found rather than the
   agent re-deciding what "knowable" means each time. **§1's proof runs this path directly**,
   because the other checks cover the Next.js path and the Node *template*, and neither touches
   the brownfield Node behaviour this theme commits to.

## 3. Shape of the whole

**Built:** an end-state sketch, inline below — the file tree a developer ends up with for each
template, the file-tree diff a brownfield run produces against an existing Next.js app and
against an existing plain-Node app, and the terminal transcript of each path end to end.

**See it:** this section. Deliberately not a runnable POC: what this epic actually ships is
*what a developer sees and what files land in their repo*, and whether that is right is judged
by reading it. **Everything below is rough and illustrative** — names, wording, and layout are
the owning issues' to settle, and the exact package name and invocation form are pending
FIX-1162's fold (§4). Review the shape and the scoping it reveals, not the polish.

**Showed:** three things. First, the two templates share almost nothing except
`fsdev.config.ts`, `flows/`, `.env.local`, and the agent-instructions file. That common set was
originally the argument for a shared deterministic primitive; after the greenfield/brownfield
split it is something better — **the reference shape the install skill's instructions point
at** (theme 1). The division into issues holds, and the boundary moved rather than broke:
FIX-548 owns its templates end to end, FIX-1159 owns the knowledge a brownfield run applies.
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

### Template A — Next.js chat app *(FIX-548, greenfield)*

```
my-app/
  app/
    api/flows/route.ts             the bare mount — serves list_flows on GET /
    api/flows/[...path]/route.ts   createNextHandler(<default export of fsdev.config.ts>)
    page.tsx                       chat UI, @flow-state-dev/react
    layout.tsx
  flows/
    chat.ts                        defineFlow — one action, one generator
  fsdev.config.ts                  default-exports createFlowState({ flows, stores })
  .env.local                       OPENAI_API_KEY=…
  AGENTS.md                        the agent-instructions file (§5 Q1 — decided)
  package.json                     next, react, @flow-state-dev/{core,engine,next,react,cli,devtool}
  next.config.ts
  tsconfig.json
```

*The mount is two files, not one: the engine registers `list_flows` as `GET /` on the mount
base and `client.listFlows()` requests it, while a required catch-all needs at least one
segment and would 404 there. Both in-repo mounts already pair the two, and the published
Next.js and Vercel guides teach the same shape.*

### Template B — framework-neutral Node API *(FIX-548, greenfield)*

```
my-api/
  flows/
    assistant.ts                   defineFlow — one action, one generator
  fsdev.config.ts                  default-exports createFlowState({ flows, stores })
  .env.local
  AGENTS.md
  package.json                     @flow-state-dev/{core,engine,node,cli,devtool}
  tsconfig.json
```

*No generated server entrypoint. FSD starts through our own CLI, which is where the network
bind guard and `.env` loading live — `serve()` in `@flow-state-dev/node` defaults its host to
all interfaces and reads no `.env` itself, so a generated three-line entrypoint would expose
the demo flow on the local network and then fail on a missing provider key. Theme 8 is
satisfied either way: FSD is a second process here, and the run says so.*

**The generated config declares a store profile, in both templates and in what a brownfield run
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
~   .gitignore       +FSD ignore entries
~   .env.local       +OPENAI_API_KEY=   (created if absent, appended if present;
                                         REFUSED if the file is already tracked — theme 6)
~   pnpm-lock.yaml   rewritten by your package manager when the run installs (theme 6)
    app/api/billing/route.ts        untouched
    app/page.tsx                    untouched — nothing overwrites a file it did not write
    next.config.ts                  untouched
```

### Diff — an install-skill run against an existing plain-Node app

```
  my-existing-api/
+   flows/hello.ts
+   fsdev.config.ts
~   AGENTS.md                       +FSD section, delimited  (created if absent, appended if present)
~   package.json                    deps +@flow-state-dev/{core,engine,node,cli,devtool}
~   .gitignore                      +FSD ignore entries
~   .env.local                      +OPENAI_API_KEY=
~   package-lock.json               rewritten by your package manager when the run installs
    src/index.ts                    untouched — nothing edits an entrypoint it did not write
                                    (theme 8: so FSD arrives here as a second process)
```

*Neither list is a boundary the way the old four-file list was. It is what these two repos
needed; another repo needs something else, which is the whole reason the brownfield path reads
the repo instead of enumerating cases. The guarantee is theme 6's, and the proof is the
report-versus-diff check in §1.*

### Transcript — greenfield, Next.js template

```
$ npx create-fsdev-app@latest my-app

? Template ›  Next.js chat app
? Model provider ›  OpenAI
? OPENAI_API_KEY ›  sk-••••••••

  Scaffolding my-app …
  Installing dependencies …

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

### Transcript — greenfield, Node API template

```
$ npx create-fsdev-app@latest my-api --template node-api

  Scaffolding my-api …  Installing dependencies …

  Next steps

    cd my-api
    npx fsdev serve    your flows, served as their own process  → http://localhost:8787
    npx fsdev dev      the FSD DevTool                          → http://localhost:4200

    npx fsdev run assistant ask --input '{"userId":"u1","question":"hello"}'

  AGENTS.md tells your coding assistant how to write FSD flows.
```

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
  and append to package.json · .gitignore · AGENTS.md
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
| FIX-1159 | The brownfield knowledge — deterministic detection scripts, the install skill's **content**, and the shared next-steps block | spec | [#1310](https://github.com/fixpoint-labs/flow-state-dev/pull/1310) | — | Spec approved, **now superseded** — #1310 designs `fsdev init` as a deterministic command; needs re-spec against this fold |
| FIX-1162 | Register the npm names the launch needs — the short CLI entry name and the scaffolding name | spec | [#1313](https://github.com/fixpoint-labs/flow-state-dev/pull/1313) | — | In spec review — the npm operations themselves still sit with the owner |
| FIX-548 | `create-fsdev-app` — the deterministic greenfield path; two templates, owned end to end | spec | [#1312](https://github.com/fixpoint-labs/flow-state-dev/pull/1312) | — | In spec review, **needs revision** — #1312 specs a thin wrapper over `fsdev init` |
| FIX-1160 | The authoring pack **and the plugin that distributes the install skill** — agent-instructions file, authoring skills, install skill | spec | [#1311](https://github.com/fixpoint-labs/flow-state-dev/pull/1311) | — | In spec review, **scope grew** — it is now the brownfield path's only delivery channel |

**The greenfield/brownfield split lands on top of specs that were already written, and two of
them no longer describe what the epic builds.** FIX-1159's approved spec is a design for a
deterministic `fsdev init`; the direction change removes that command's brownfield role, so the
approval stands on a document whose central deliverable is gone. FIX-548's spec is written as a
thin wrapper over it. Both need to go back through spec before either is implemented — that is
this fold's largest downstream cost and it is stated here rather than discovered later. What
survives from FIX-1159's spec unchanged is everything it *verified* about our own packages
(`serve()` binds all interfaces and reads no `.env`; the bare `/api/flows` is a real endpoint
needing its own file); those are facts about the code, not consequences of the command.

**Dependencies.** FIX-1160 now depends on FIX-1159 — it packages content that issue authors.
FIX-1159 still lands before FIX-548, now only for the shared next-steps block (theme 5). None
of these is an accepted deferral; each is a real ordering constraint on merge, and each pair can
be specced in parallel.

**Raised up but not folded here** — each belongs to a separate pass, and none is a gap in this
one:

- **FIX-1162 has verified that `create-fsd-app` is unobtainable** (an unrelated project has held
  it since 2024) and proposes `create-fsdev-app`. This document now uses `create-fsdev-app`,
  because writing a name we cannot have into freshly drafted prose is a defect on its own. The
  larger half of that spec's finding is **untouched**: whether the `@flow-state-dev/` npm scope
  is even ours (unverified — nothing under it has ever been published), and whether the headline
  command a stranger types is the short name or the scoped one. §3's transcripts are illustrative
  on that point and are not a decision.
- **FIX-548's spec recommends dropping the `node-api` template** now that the Node path
  generates no server file. Theme 2 still says two templates; the recommendation is recorded, not
  adopted.
- **FIX-1160's POC established that Claude Code has no bare-URL plugin install** — the path is
  `plugin marketplace add <source>` then `plugin install`, so a marketplace manifest is a
  required distribution artifact rather than a public listing. Consistent with §5 Q2 as written;
  it sharpens Q4 rather than reopening Q2.

## 5. Open cross-cutting questions

Q1–Q3 are **decided** and stay here with their answers, so no issue reopens them. **Q4 is open**
and blocks nothing: it exists because the split changed what an already-made decision costs.

### ~~Q1 — What filename do the agent instructions go to, and what happens when one is already there?~~ — decided: `AGENTS.md`

*Raised while drawing §3's diffs; it touches all three workstreams (FIX-1160 authors the
content, FIX-1159's skill places it, FIX-548 ships it in both templates), so no single issue can
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
and the filename is the same either way. **Closed — not reopenable by an issue.**

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

- **Epic drafted** — three issues under one outcome: a stranger reaches a streaming AI feature
  in their own project from one command, and their coding assistant writes FSD code that runs.
  Scoped `create-fsd-app` down to a thin wrapper over `fsdev init`, and recorded the accepted
  cost of shipping two templates instead of one.
- **After the inline end-state sketch** — added theme 5's one-next-steps-block clause and
  theme 6 (init is additive over its named in-place edits), because drawing the two diffs made
  visible what the prose had not: both entry paths print the same block, and the risky half of
  init is a short, nameable file list.
- **Q1 answered — `AGENTS.md`** — theme 6 re-drafted to own `AGENTS.md` as a fourth in-place
  edit carrying an append-only, never-overwrite guarantee, because the spec had recommended
  appending to that file while theme 6 listed only three editable ones. §3's diffs and the
  "Nothing else was touched" output are corrected to match.
- **After epic review** — added theme 8 (a mounted route where the host's conventions make the
  location knowable, a second process otherwise, and the run says which), because §3 had
  surfaced that asymmetry inside a section that explicitly binds nothing, leaving the constraint
  unowned across FIX-1159 and FIX-548. Corrected theme 5's premise: `@flow-state-dev/devtool` is
  an *optional peer* of the CLI, so outside this monorepo `fsdev dev` cannot resolve its assets.
- **Q2 answered — install-by-URL only** — theme 3 now carries the plugin's distribution channel,
  because FIX-1160's scope turns on it and a decision living only in §5 is one a child issue
  reads too late.
- **Q3 answered — no rename, qualify instead** — themes 3 and 4 now write *Claude skills* where
  this doc means the packaged kind, because a convention the epic asks FIX-1160 to follow has to
  hold in the epic's own prose first.
- **After epic review (round 2)** — theme 6's boundary widened to name the lockfile: init has to
  install for the next-steps block to be runnable at all (theme 5), an install rewrites a file
  init does not author, and a four-file guarantee that omits it is a promise init breaks on its
  first run. FIX-1162 added to the running index.
- **After epic review (round 3)** — §1's proof for FIX-1160 now runs *through the plugin* rather
  than through the scaffolded `AGENTS.md` alone, because the goal check as written could pass in
  full while the plugin's manifest, install source, and skills were unusable — and §5 Q2 had
  just narrowed the plugin to that one channel.
- **After convergence — uncontested corrections** (not a review round). FIX-548's scope named
  the Next.js chat page as the wrapper's demo content; theme 1 was re-drafted around *demo
  content vs. scaffolding*; §1's proof gained the existing-Node run; and three inline factual
  fixes landed (`.agents/skills/`, the required store profile, §1's metadata line moving below
  the problem).
- **After convergence — completing the previous correction** (not a review round). The
  demo-content boundary reached the flow file, and §1's brownfield checks began seeding
  distinctive content into each of theme 6's four in-place files.
- **Owner direction change, post-convergence — brownfield becomes an agent skill; greenfield
  stays a deterministic command.** Not a review round: an owner decision arriving after
  convergence, which the convergence rule permits. **The reason is the enumeration argument,
  recorded in §1** — across three review rounds the deterministic init grew a separate branch for
  each of a dozen host-shape cases (four merge semantics, CommonJS vs ESM, two Node ranges,
  three package-manager signals, a tracked `.env.local`, an existing config, an existing script,
  npm's option separator, `create-next-app` drift, the bind guard, a store race, provider SDK
  selection), each found by a reviewer one at a time, with no round at which they stop. That is
  a command trying to enumerate every host repo; an agent reads the repo in front of it instead,
  and the developer reviews the diff. **Detection stays deterministic and ships as scripts the
  skill calls; deterministic mutation is what goes.** Themes 1, 5, 6 and 8 were re-drafted rather
  than annotated: theme 1 because the whole init-as-shared-primitive architecture it described
  is gone, themes 5, 6 and 8 because each described init's mutation behaviour. **Theme 6's
  safety properties were preserved as instruction rather than dropped** — never overwrite what it
  did not author, refuse rather than write a credential into a tracked `.env.local`, install
  through the project's own package manager, name every file it touched — and §1's proof gained
  the **report-versus-diff** check, because an open boundary cannot be verified by asserting a
  closed list survived. §1's *Not doing* entry against an authoring MCP server was re-argued: its
  old reasoning ("the CLI already carries the actions") inverted, though the conclusion holds.
  §1's holistic necessity was re-ranked — **FIX-1160 is now load-bearing**, since the install
  skill reaches a stranger only through the plugin it packages, and FIX-548 is stronger because
  the two-command alternative that undercut it no longer exists. Ownership recorded in theme 1:
  FIX-1159 authors the detection scripts and the skill's content, FIX-1160 packages and
  distributes it. §3's trees, diffs and transcripts, and §4's index, follow. **New Q4** asks the
  owner whether install-by-URL still holds now that the plugin is the brownfield path's only
  channel — the decision they made priced a different thing. Two corrections travelled with this
  pass because the surrounding prose was being re-drafted anyway and leaving them would have
  written known-false text: the greenfield package is `create-fsdev-app` (FIX-1162 verified
  `create-fsd-app` unobtainable since 2024), and the Node paths generate no server entrypoint
  (FIX-1159 verified `serve()` binds all interfaces and reads no `.env`). The rest of FIX-1162's
  naming finding, FIX-548's proposal to drop the Node template, and FIX-1160's marketplace-
  manifest mechanism are recorded in §4 as raised, not folded.
