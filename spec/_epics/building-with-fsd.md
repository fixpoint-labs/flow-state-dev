# Epic — Building with FSD: the first hour in someone else's project

## 1. Purpose & objective *(the gated sign-off surface)*

Someone who hears about FSD today cannot use it. The root README tells them to clone our
monorepo, run our tests, and read our reference app. There is no init command and no scaffold
of any kind, so putting FSD into a project they already have means copying files out of our
repo by hand — and the coding assistant they would normally lean on has nothing to go on, so
it writes FSD-shaped code that does not run. Public Launch is the reason this is now rather
than later: everything else in that project points people at a front door that is not there.

*Linear epic **FIX-1161** · Branch `epic/building-with-fsd` · Epic PR
[#1301](https://github.com/fixpoint-labs/flow-state-dev/pull/1301) (never merged) · Project
**Public Launch**.*

**Outcome.** Someone who has never used FSD gets a working AI feature streaming from a real
model inside their own project — new or existing — from a single command, without cloning our
repository or reading our source; and the coding assistant they work with writes FSD code that
runs rather than code that merely looks right.

**Proof** — carried by the issues' own goal checks, no new measurement apparatus:

- *FIX-1159, mounted-route path* — a fresh `create-next-app`, then the init command, then
  `fsdev run` returns a streamed model response, and a route that existed before init still
  responds.
- *FIX-1159, second-process path* — the same init command in an **existing plain-Node
  project**: the printed command starts the generated server, a call to it returns a streamed
  model response, and the project's own server still runs. **Theme 8 makes this a different
  shape, not the same check twice** — host detection, and a second process rather than a
  mounted route — so the Next.js run above does not cover it, and FIX-548's Node run exercises
  the *template* rather than init into a project that already exists. Without this one, Node
  detection and the second-process wiring can be entirely broken while every other listed
  proof passes. Same apparatus as the rest; no new measurement machinery.
- *FIX-548* — in an empty directory with only a provider key in the environment, the npx
  command followed by the printed dev command yields a streamed model response **from the
  surface that template ships** — the chat page for Next.js, the API for Node. Run once per
  template.
- *FIX-1160* — one recorded run covering **both halves of the pack**: the Claude plugin
  installed from its URL and one of its packaged skills invoked, and then a coding assistant
  in a freshly scaffolded project, given a stated feature goal and nothing else, produces a
  flow that passes `fsdev run`. A single observation, stated as such, not a metric. **The
  plugin is inside the run because it is a deliverable** — a check the scaffolded `AGENTS.md`
  satisfies on its own would pass while the plugin's manifest, install URL, and packaged
  skills sat unexercised until a stranger tried them.

**Holistic necessity.** Three issues of substance, and the honest question is whether it is
two. FIX-1159 (`fsdev init`) is the substance — it is the only thing that reaches an existing
project, and both other issues are built on it. FIX-1160 (the authoring pack) carries the
objective's second clause; cutting it cuts the objective in half, so it stays. **FIX-548
(`create-fsd-app`) is the weakest of the three**: `npx create-next-app && npx
@flow-state-dev/cli init` already reaches the outcome in two commands, and a starter mostly
saves one — one command *and* the scoped package name a stranger would otherwise have to
know. **Kept, scoped down** to a thin wrapper — bare app, then init, then the template's
**demo content**: one demo flow, and for the Next.js template the chat page that flow talks
to.

**The wrapper owns demo content; init owns scaffolding.** That split is forced rather than
chosen. Theme 2 promises a Next.js *chat app*, `create-next-app` ships its own stock
`app/page.tsx`, and theme 6 forbids init from overwriting a file it did not write — so a chat
UI can only come from the greenfield wrapper, and never from init. Without that clause no
permitted step produced the advertised chat app. Scaffolding is the other half and stays
singular: detection, file authoring, config generation, and the next-steps block are all
`fsdev init`'s, and none of them exists twice. If it grows template logic that `fsdev init`
does not have, that is the signal it should have been dropped.

**FIX-1162 (npm name registration) is a fourth issue but not a fourth workstream.** npm short
names are first-come and unrecoverable, and the objective promises *a single command* — which
needs a name we own. It serves FIX-1159's headline command as much as FIX-548's, so it
survives even if FIX-548 is cut. **It sharpens the question above rather than answering it:**
if FIX-1162 secures the short name, FIX-548 no longer saves a stranger the scoped package
name, and only the saved command is left — the weaker half of the case for keeping it.

**Not doing.**

- An authoring MCP server. The CLI already carries the actions; a server that shadows it is a
  second surface that can disagree with the first.
- A block / plugin / component registry (FIX-147 remains independent).
- Any template beyond the two agreed.
- Hosted or cloud onboarding, accounts, deploy buttons.
- The docs-site IA revamp, brand pass, and pre-launch docs sweep (FIX-601 / FIX-551 / FIX-550
  are separate Public Launch issues). This epic writes only the docs its own commands require.
- Editor-specific rules files beyond the one universal agent-instructions file.

**Kill line.** If the first cohort stalls *after* hello-world rather than before it — they get
a running app and then cannot reach their second feature — then setup was never the bottleneck
and the investment belongs in worked examples and concept guides. Concretely: if the people
asking for help are the ones who already have a running FSD app, finishing this is the wrong
call.

## 2. Themes & long-horizon direction

1. **Both entry paths ship, and `fsdev init` is the primitive both rest on.**
   `create-fsd-app` is a thin wrapper over it: bare app, then init, then the template's demo
   content — one demo flow, plus the chat page for the Next.js template. **The wrapper owns
   demo content; init owns scaffolding**, and no scaffolding logic exists in two places. The
   line falls there because theme 6 forbids init from overwriting a file it did not write and
   `create-next-app` ships its own `app/page.tsx`: a chat UI is therefore the greenfield
   wrapper's or nobody's. **This is why FIX-1159 lands before FIX-548** —
   they can be specced in parallel, but the wrapper cannot merge before the thing it wraps.
   **FIX-1162 gates FIX-548 one level earlier still**: a spec cannot commit to a headline
   command under a package name we have not registered.

2. **Two templates, and only two: a Next.js chat app and a framework-neutral Node API.** The
   accepted cost is two starters to keep green on machines we do not control, which is why
   FIX-548's proof runs once per template rather than once. An issue that wants a third
   template has hit a cross-cutting question — comment up on this PR rather than adding it.

3. **Agent-authoring help is a file plus a plugin, never a server.** A universal
   agent-instructions file written into the consumer's project by init (works with any coding
   assistant), plus an installable Claude Code plugin carrying the deeper authoring skills.
   `packages/mcp` points outward — it exposes flows so other people's agents can call them —
   and is not an authoring aid; nothing in this epic changes that direction. **The plugin
   ships install-by-URL only at launch — no public directory listing** (§5 Q2, decided), which
   narrows FIX-1160's distribution channel and nothing else about it. **That single channel is
   the one §1's proof runs through** — with no directory listing, the install URL is the only
   way in, so nothing would exercise it before a stranger did. **And the epic writes
   *Claude skills* / *the Claude plugin* wherever the packaged kind could be read as FSD's own
   runtime `skills`, which keeps the bare word** (§5 Q3, decided).

4. **Nothing this epic produces reads from our monorepo at runtime.** A constraint the
   objective imposes, not a new call, and it binds two issues at once: a template cannot carry
   `workspace:*` dependencies or a build script that reaches the repo root (which is why
   `apps/kitchen-sink` is not a template), and the five build-with skills in `.agents/skills/`
   all hardcode monorepo paths today, so FIX-1160 packages rewritten **Claude skills** rather
   than copying those.

5. **DevTool and CLI discovery is not its own workstream — it is folded into FIX-1159.**
   `@flow-state-dev/devtool` is an **optional peer** of `@flow-state-dev/cli`, satisfied
   inside this monorepo by a dev dependency and by nothing at all in a consumer's project —
   so outside our repo `fsdev dev` cannot resolve its assets and fails. The gap is therefore
   two things, not one: init has to make the DevTool **resolvable** as well as **known**.
   Both are FIX-1159's, and neither becomes an issue of its own. **There is one next-steps block,
   authored in FIX-1159 and reused verbatim by FIX-548** — a second copy is how the two entry
   paths start telling people different things. **A next-steps block must not print a command
   the project cannot run**, which is what ties the two halves together.

6. **`fsdev init` is additive, and its boundary is the four files it authors plus the lockfile
   its install rewrites.** Init edits exactly four things in place and nothing else:
   `package.json` (dependencies and a script), `.gitignore` (FSD's ignore entries),
   `.env.local` (an appended key), and `AGENTS.md` (an appended, delimited FSD section — the
   filename decided in §5 Q1). What goes *into* each is FIX-1159's to settle; this theme fixes
   the boundary and the guarantee: **all four are append-only — init never overwrites a file
   it did not write, and never rewrites content it did not author.** That is what makes taking
   the shared `AGENTS.md` filename safe, and it is what makes FIX-1159's goal check (a route
   that existed before init still responds) a check on the whole design rather than one code
   path.

   **A fifth file moves, and init does not author it: the lockfile.** Declaring dependencies
   is not the same as making them available — until an install runs, `fsdev` is not on the
   project's path and the next-steps block prints commands the project cannot run, which theme
   5 forbids. So init installs, the project's own package manager rewrites the lockfile, and
   that edit is **delegated rather than append-only**. Two things follow, and both bind: init
   runs the install **through the detected package manager** rather than writing a lockfile
   itself, and **the output names the lockfile alongside the four** — a repo with a
   frozen-lockfile CI job needs to see it coming. **The output states what happened to each of
   the five**; a "nothing else was touched" line printed in a repo where init just appended to
   a tracked `AGENTS.md` and rewrote `pnpm-lock.yaml` is the failure this theme prevents.

7. **No separate docs issue.** End-user functionality is documented in the change set that
   ships it. The docs-site work named in §1's *Not doing* stays outside this epic.

8. **FSD arrives as a mounted route only where the host's conventions make the mount point
   knowable; everywhere else it arrives as a second process — and init says which.** Next.js
   App Router gives init a location it can derive, so it writes a real route into the existing
   app. A plain-Node project does not, and theme 6 forbids editing an entrypoint init did not
   write, so there FSD runs as a separate server alongside the one already there. Both are
   legitimate; what is not legitimate is leaving the developer to work out which they got.
   **Greenfield and brownfield must mean the same thing by "wire FSD into your project"** —
   the Node *template* and the Node *init* path deliver the same process model, described in
   the same words. This binds FIX-1159 (what init writes) and FIX-548 (what the Node template
   ships), which is why it is a theme rather than either issue's local call. Surfaced by §3's
   sketch, where it sat as an observation with no owner. **§1's proof runs this path
   directly** — a real init into an existing plain-Node project — because the two checks that
   were already listed cover the Next.js path and the Node *template*, and neither touches the
   brownfield Node behaviour this theme commits to.

## 3. Shape of the whole

**Built:** an end-state sketch, inline below — the file tree a developer ends up with for each
template, the file-tree diff `fsdev init` produces against an existing Next.js app and against
an existing plain-Node app, and the terminal transcript of each path end to end.

**See it:** this section. Deliberately not a runnable POC: what this epic actually ships is
*what a developer sees in their terminal and what files land in their repo*, and whether that
is right is judged by reading it. **Everything below is rough and illustrative** — names,
wording, and layout are FIX-1159's to settle. Review the shape and the scoping it reveals, not
the polish.

**Showed:** three things. First, the two templates share almost nothing except
`fsdev.config.ts`, `flows/`, `.env.local`, and the agent-instructions file — and that common
set is exactly what `fsdev init` writes. Everything past it is per-template: the host wiring
(a route for Next.js, a server entrypoint for Node) and the Next.js chat page. The division
into issues holds, and the boundary falls there — init owns the common set, the wrapper owns
what is left. **Epic review found that boundary drawn but not assigned**: the chat page sat in
this tree with no issue's scope claiming it, so no permitted step produced the advertised chat
app. Theme 1 and §1 now give it to FIX-548. Second, the next-steps block has to name **two** servers with
different jobs (the app on its own port, the DevTool on 4200); printing both without saying
which is which is how a first-hour user lands on a blank page, and both entry paths print it.
Third, an asymmetry the prose hid: in a Next.js app init can mount a real route, because App
Router conventions make the location knowable, but in a plain-Node app it cannot edit an
entrypoint it did not write — so init there delivers a **second process**, not an integrated
route. That third finding is now **theme 8**, which is where it binds; it sat here as an
observation with no owner until epic review pointed out that §3 is explicitly non-binding.

**Changed:** added theme 5's second half (one next-steps block, authored in FIX-1159, reused
verbatim) and theme 6 (init is additive, over its named in-place edits). Both came out of
drawing the diffs; neither was visible in prose.

### Template A — Next.js chat app

```
my-app/
  app/
    api/flows/[...path]/route.ts   createNextHandler(<default export of fsdev.config.ts>)
    page.tsx                       chat UI, @flow-state-dev/react — the wrapper's demo
                                   content (theme 1); init never writes this file
    layout.tsx
  flows/
    chat.ts                        defineFlow — one action, one generator
  fsdev.config.ts                  default-exports createFlowState({ flows, stores })
  .env.local                       OPENAI_API_KEY=…
  AGENTS.md                        written by init (§5 Q1 — decided)
  package.json                     next, react, @flow-state-dev/{core,engine,next,react,cli}
  next.config.ts
  tsconfig.json
```

### Template B — framework-neutral Node API

```
my-api/
  src/
    server.ts                      serve(<default export of fsdev.config.ts>)
  flows/
    assistant.ts
  fsdev.config.ts                  default-exports createFlowState({ flows, stores })
  .env.local
  AGENTS.md
  package.json                     @flow-state-dev/{core,engine,node,cli}
  tsconfig.json
```

**The generated config declares a store profile, in both templates and in what init writes.**
`stores` is a required option and needs at least one named profile, so
`createFlowState({ flows })` alone does not typecheck and does not initialize — which would
block every command the next-steps block prints. Illustratively that is
`stores: { default: { primary: inMemoryStores() } }`; **which profile ships is FIX-1159's
call**, since init authors the config and the templates inherit it.

### Diff — `fsdev init` into an existing Next.js app

```
  my-existing-app/
+   app/api/flows/[...path]/route.ts
+   flows/hello.ts
+   fsdev.config.ts
~   AGENTS.md        +FSD section, delimited   (created if absent, appended if present)
~   package.json     deps +@flow-state-dev/{core,engine,next,react,cli} · scripts +"fsdev"
~   .gitignore       +FSD ignore entries
~   .env.local       +OPENAI_API_KEY=   (created if absent, appended if present)
~   pnpm-lock.yaml   rewritten by your package manager when init installs (theme 6)
    app/api/billing/route.ts        untouched
    app/page.tsx                    untouched — theme 6; a chat UI is the greenfield
                                    wrapper's (FIX-548), never init's
    next.config.ts                  untouched
```

### Diff — `fsdev init` into an existing plain-Node app

```
  my-existing-api/
+   src/fsdev-server.ts             serve(…) — a second process, run alongside yours
+   flows/hello.ts
+   fsdev.config.ts
~   AGENTS.md                       +FSD section, delimited  (created if absent, appended if present)
~   package.json                    deps +@flow-state-dev/{core,engine,node,cli}
~   .gitignore                      +FSD ignore entries
~   .env.local                      +OPENAI_API_KEY=
~   package-lock.json               rewritten by your package manager when init installs (theme 6)
    src/index.ts                    untouched — init does not edit an entrypoint it did not write
                                    (theme 8: so FSD arrives here as a second process)
```

### Transcript — greenfield, Next.js template

```
$ npx create-fsd-app@latest my-app

? Template ›  Next.js chat app
? Model provider ›  OpenAI
? OPENAI_API_KEY ›  sk-••••••••

  Scaffolding my-app …
  Installing dependencies …
  Running fsdev init …

  Created   app/api/flows/[...path]/route.ts   flows/chat.ts   fsdev.config.ts   AGENTS.md
  Wrote     .env.local  (OPENAI_API_KEY)

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
$ npx create-fsd-app@latest my-api --template node-api

  Scaffolding my-api …  Installing dependencies …  Running fsdev init …

  Next steps

    cd my-api
    npm run dev        your API, flows mounted at /api/flows/*  → http://localhost:8787
    npx fsdev dev      the FSD DevTool                          → http://localhost:4200

    npx fsdev run assistant ask --input '{"userId":"u1","question":"hello"}'

  AGENTS.md tells your coding assistant how to write FSD flows.
```

### Transcript — `fsdev init` into an existing Next.js app

```
$ cd my-existing-app
$ npx @flow-state-dev/cli init

  Detected  Next.js 15 (App Router)  ·  package manager: pnpm
  Adapter   @flow-state-dev/next

? Model provider ›  OpenAI
? OPENAI_API_KEY ›  found in .env.local — using it

  Created   app/api/flows/[...path]/route.ts
            flows/hello.ts
            fsdev.config.ts
  Modified  package.json   (+6 dependencies, +1 script)
            .gitignore     (FSD ignore entries)
            AGENTS.md      (appended an FSD section — your existing content is unchanged)
  Installed via pnpm — pnpm-lock.yaml was rewritten by pnpm, not by init

  Nothing was overwritten. Every file init wrote was created or appended to.

  Next steps

    pnpm dev             your app, now serving /api/flows/*  → http://localhost:3000
    pnpm fsdev dev       the FSD DevTool                     → http://localhost:4200

    pnpm fsdev run hello send --input '{"userId":"u1","message":"hi"}'

  AGENTS.md tells your coding assistant how to write FSD flows.
```

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| FIX-1159 | `fsdev init` — wire FSD into an existing project (incl. the next-steps block and DevTool discovery) | spec | — | — | Needs spec — held at the objective gate |
| FIX-1162 | Register the npm names the launch needs — the short CLI entry name and the `create-fsd-app` scaffolding name | spec | — | — | With the owner — npm credentials |
| FIX-548 | `create-fsd-app` — npx-able scaffolding, a thin wrapper over init; two templates and their demo content, incl. the Next.js chat page | spec | — | — | Blocked by FIX-1159 and FIX-1162 |
| FIX-1160 | Consumer authoring pack — agent-instructions file + Claude plugin, install-by-URL at launch | spec | — | — | Needs spec — held at the objective gate |

**No spec PR has opened yet, and the empty cells say why: every row is held behind the
epic-objective gate** (§1) — the epic's own sign-off, not a per-issue one. All four are
Feature-labelled, so all four derive the **spec** route and each carries its own
spec-approval gate when it ramps. FIX-1159 lands before FIX-548, and FIX-1162 gates
FIX-548's headline command (theme 1).

**FIX-1162 is the one row that is not an agent workstream.** Registering an npm name needs
account credentials nothing in this epic holds, so it sits with the owner and is tracked
here rather than dispatched; its route reads `spec` because the label derives it, but no
spec is written and no spec gate is waiting. It is done when the names are secured, which
is what unblocks FIX-548 on that side.

## 5. Open cross-cutting questions

All three questions are **decided** and stay here with their answers, so no issue reopens
them. Nothing on this list blocks anything.

### ~~Q1 — What filename does init write the agent instructions to, and what happens when one is already there?~~ — decided: `AGENTS.md`

*Raised while drawing §3's diffs; it touches all three issues (FIX-1160 authors the content,
FIX-1159 writes it, FIX-548 ships it in both templates), so no single issue can settle it.*

**Plain terms.** `fsdev init` drops a file into a stranger's repository telling their coding
assistant how to write FSD code. `AGENTS.md` is the filename assistants already look for — and
it is also a filename many projects already have, holding instructions that have nothing to do
with us.

**The trade-off.** `AGENTS.md` gets picked up by every assistant with no configuration, and
risks landing on top of, or tangled into, a file the project already owns. A namespaced file
(`.fsd/agent-instructions.md`) can never collide, and is read by nobody unless the developer
wires it up — which is the same as not shipping it.

**My recommendation was: write `AGENTS.md`, and never overwrite.** If the file exists, append a
delimited FSD section and say so in the output; if it does not, create it. Pickup is the whole
point of the objective's second clause, and a file nothing reads fails that clause silently
rather than loudly.

**Cost of being wrong.** Choosing `AGENTS.md` and being wrong is noisy and recoverable — a
developer sees a diff in a tracked file and deletes it. Choosing the namespaced file and being
wrong is quiet: FIX-1160 ships, nothing reads it, and the objective's second half is unproven
while looking done.

**Resolution — `AGENTS.md`.** Decided by the objective's first line: the outcome is that the
assistant beside the developer writes working FSD code, and a namespaced file nothing reads
fails that outcome by construction. **Collision risk is the cost of the objective, not an
alternative to it** — so it is managed, not avoided. **Behaviour init implements: append a
delimited FSD section, never overwrite, and leave any pre-existing content untouched.** That
guarantee is now carried by **theme 6**, which owns `AGENTS.md` as an in-place edit alongside
the other three; this entry is the record of why. **Closed — not reopenable by an issue.** A
sub-issue that finds the append mechanics hard is looking at an implementation problem in
FIX-1159, not at this decision.

### ~~Q2 — Is the Claude Code plugin publicly listed at launch, or install-by-URL only?~~ — decided: install-by-URL only

*Raised by the epic-spec against the verified state: there is no packaging or publishing path
for skills today — no `.claude-plugin/`, no marketplace manifest. It sets FIX-1160's scope and
touches the launch, so it is not FIX-1160's alone.*

**Plain terms.** The plugin can be installed from a URL by anyone we tell, or listed where
Claude Code users browse for plugins. Listing puts our name in a public directory with an
implied promise that it keeps working.

**The trade-off.** A listing is discovery we cannot buy — people find FSD without us
introducing it. It is also a standing maintenance commitment on a surface we have never
shipped before, made in the same weeks as the launch itself. Install-by-URL costs nothing to
maintain and reaches only people already reading our docs.

**My recommendation: install-by-URL at launch, list afterwards.** The objective's proof is one
recorded run, not adoption; a listing does not make that run more likely to pass, and it adds a
public surface to a launch that already has several. Delisting later is worse than listing
later.

**What would change my mind:** if the launch plan is counting on plugin-directory discovery as
a channel, that is a business fact I do not have and it inverts this.

**Cost of being wrong.** Wrong on URL-only, and we leave discovery on the table for a few weeks
— fully recoverable. Wrong on listing, and we own a public entry we may not be ready to keep
green during the noisiest period we will have.

**Resolution — install-by-URL only at launch.** Decided by the product owner, on reasoning
that goes past the recommendation above: a public listing is a **support commitment in the
week we can least afford one**, and the asymmetry is what settles it — a listing is trivially
added afterwards, while delisting later reads as abandonment. No public directory listing
during the launch window. **FIX-1160 is scoped accordingly — the plugin still ships; only its
distribution channel is narrowed.** And because the channel is now singular, **§1's proof runs
through it**: FIX-1160's recorded run installs the plugin from its URL and invokes one packaged
skill, so the only remaining way in is also the one we have checked. Carried by theme 3.
**Closed — not reopenable by an issue.**

### ~~Q3 — FSD ships a runtime concept called `skills`, and FIX-1160 ships Claude `skills`. Rename ours, rename theirs, or ship the collision?~~ — decided: no rename, qualify instead

*Raised by the epic-spec: the two words would sit on adjacent public docs pages, and FIX-417 /
FIX-424 own the existing one. It touches naming across the set, so it is not FIX-1160's alone.*

**Resolution — no rename, and the premise that the two are unrelated is rejected.** Both are
the same *kind* of thing — a packaged capability an agent loads — at different layers, so the
shared word is coherent rather than colliding, and this is not the incoherence case it was
raised as. The resolution is **qualification, not renaming**: write *Claude skills* or *the
Claude plugin* wherever ambiguity is genuinely possible, and let FSD's runtime concept keep
the bare name `skills`. **FIX-417 and FIX-424 are unaffected and must not be touched.**
FIX-1160's prose follows the qualification convention, and so does this document (themes 3
and 4). Carried by theme 3. **Closed — not reopenable by an issue.**

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
  location knowable, a second process otherwise, and init says which), because §3 had surfaced
  that asymmetry inside a section that explicitly binds nothing, leaving the constraint
  unowned across FIX-1159 and FIX-548. Corrected theme 5's premise: `@flow-state-dev/devtool`
  is an *optional peer* of the CLI, so outside this monorepo `fsdev dev` cannot resolve its
  assets — DevTool discovery is not purely a "nobody is told it exists" gap.
- **Q2 answered — install-by-URL only** — theme 3 now carries the plugin's distribution
  channel, because FIX-1160's scope turns on it and a decision living only in §5 is one a
  child issue reads too late.
- **Q3 answered — no rename, qualify instead** — themes 3 and 4 now write *Claude skills*
  where this doc means the packaged kind, because a convention the epic asks FIX-1160 to
  follow has to hold in the epic's own prose first.
- **After epic review (round 2)** — theme 6's boundary widened to name the lockfile: init has
  to install for the next-steps block to be runnable at all (theme 5), an install rewrites a
  file init does not author, and a four-file guarantee that omits it is a promise init breaks
  on its first run. §3's two diffs and the existing-Next.js transcript are corrected to match.
  FIX-1162 added to the running index — it was parented under the epic after the `npx fsdev`
  naming correction and had no row; §1 and theme 1 now say what it gates.
- **After epic review (round 3)** — §1's proof for FIX-1160 now runs *through the plugin*
  (installed from its URL, one packaged skill invoked) rather than through the scaffolded
  `AGENTS.md` alone, because the goal check as written could pass in full while the plugin's
  manifest, install URL, and skills were unusable — and §5 Q2 had just narrowed the plugin to
  that one channel, leaving nothing else to exercise it. Theme 3 and Q2's record carry the
  same clause. The running index is refreshed against the coordinator's handles and now states
  why no row has a spec PR, and that FIX-1162 waits on the owner rather than on a spec.
- **After convergence — uncontested corrections** (not a review round; the epic PR had spent
  its budget). Two gaps and three factual fixes, none of which reopens a settled decision.
  FIX-548's scope now names the Next.js **chat page** as the wrapper's demo content, because
  theme 2 promised a chat app while every permitted step left `create-next-app`'s stock page —
  the promise had no owner. Theme 1 re-drafted around *demo content vs. scaffolding* so the
  "no scaffolding logic in two places" tripwire still bites on logic and not on a demo file;
  §3's tree, its `page.tsx untouched` line, *Showed*, and the running index moved with it.
  §1's proof gained the **existing-Node init run** (theme 8 commits init to a brownfield Node
  path that no listed check exercised — Node detection could be broken while every proof
  passed); theme 8 carries the same clause. Corrected inline: the skills directory is
  `.agents/skills/`, not `agents/skills/`; the generated config must declare a store profile,
  since `stores` is required and `createFlowState({ flows })` would not typecheck; and §1's
  metadata line moved below the opening problem, per AGENTS.md — nothing precedes the problem.
