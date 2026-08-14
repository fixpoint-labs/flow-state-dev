# Epic — Building with FSD: the first hour in someone else's project

Linear epic: **FIX-1161** · Branch `epic/building-with-fsd` · Epic PR
[#1301](https://github.com/fixpoint-labs/flow-state-dev/pull/1301) (never merged) · Project
**Public Launch**

## 1. Purpose & objective *(the gated sign-off surface)*

Someone who hears about FSD today cannot use it. The root README tells them to clone our
monorepo, run our tests, and read our reference app. There is no init command and no scaffold
of any kind, so putting FSD into a project they already have means copying files out of our
repo by hand — and the coding assistant they would normally lean on has nothing to go on, so
it writes FSD-shaped code that does not run. Public Launch is the reason this is now rather
than later: everything else in that project points people at a front door that is not there.

**Outcome.** Someone who has never used FSD gets a working AI feature streaming from a real
model inside their own project — new or existing — from a single command, without cloning our
repository or reading our source; and the coding assistant they work with writes FSD code that
runs rather than code that merely looks right.

**Proof** — carried by the issues' own goal checks, no new measurement apparatus:

- *FIX-1159* — a fresh `create-next-app`, then the init command, then `fsdev run` returns a
  streamed model response, and a route that existed before init still responds.
- *FIX-548* — in an empty directory with only a provider key in the environment, the npx
  command followed by the printed dev command yields a streamed model response. Run once per
  template.
- *FIX-1160* — one recorded run: a coding assistant in a freshly scaffolded project, given a
  stated feature goal and nothing else, produces a flow that passes `fsdev run`. A single
  observation, stated as such, not a metric.

**Holistic necessity.** Three issues, and the honest question is whether it is two. FIX-1159
(`fsdev init`) is the substance — it is the only thing that reaches an existing project, and
both other issues are built on it. FIX-1160 (the authoring pack) carries the objective's
second clause; cutting it cuts the objective in half, so it stays. **FIX-548
(`create-fsd-app`) is the weakest of the three**: `npx create-next-app && npx fsdev init`
already reaches the outcome in two commands, and a starter mostly saves one. **Kept, scoped
down** to a thin wrapper — bare app, then init, then one demo flow, with no scaffolding logic
of its own. If it grows template logic that `fsdev init` does not have, that is the signal it
should have been dropped.

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
   `create-fsd-app` is a thin wrapper over it: bare app, then init, then one demo flow. No
   scaffolding logic exists in two places. **This is why FIX-1159 lands before FIX-548** —
   they can be specced in parallel, but the wrapper cannot merge before the thing it wraps.

2. **Two templates, and only two: a Next.js chat app and a framework-neutral Node API.** The
   accepted cost is two starters to keep green on machines we do not control, which is why
   FIX-548's proof runs once per template rather than once. An issue that wants a third
   template has hit a cross-cutting question — comment up on this PR rather than adding it.

3. **Agent-authoring help is a file plus a plugin, never a server.** A universal
   agent-instructions file written into the consumer's project by init (works with any coding
   assistant), plus an installable Claude Code plugin carrying the deeper authoring skills.
   `packages/mcp` points outward — it exposes flows so other people's agents can call them —
   and is not an authoring aid; nothing in this epic changes that direction.

4. **Nothing this epic produces reads from our monorepo at runtime.** A constraint the
   objective imposes, not a new call, and it binds two issues at once: a template cannot carry
   `workspace:*` dependencies or a build script that reaches the repo root (which is why
   `apps/kitchen-sink` is not a template), and the five build-with skills in `agents/skills/`
   all hardcode monorepo paths today, so FIX-1160 packages rewritten skills rather than
   copying those.

5. **DevTool and CLI discovery is not its own workstream — it is folded into FIX-1159.**
   `@flow-state-dev/devtool` is already a dev dependency that `fsdev dev` serves
   automatically; the gap is purely that nobody is told it exists. It is fixed by what init
   writes and prints. **There is one next-steps block, authored in FIX-1159 and reused
   verbatim by FIX-548** — a second copy is how the two entry paths start telling people
   different things.

6. **`fsdev init` is additive.** Its only in-place edits are `package.json` (dependencies and
   a script), `.gitignore` (`.fsdev/`), and an appended key in `.env.local`. It never
   overwrites a file it did not write. That is what makes FIX-1159's goal check — a route that
   existed before init still responds — a check on the whole design rather than on one code
   path.

7. **No separate docs issue.** End-user functionality is documented in the change set that
   ships it. The docs-site work named in §1's *Not doing* stays outside this epic.

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
set is exactly what `fsdev init` writes, with one host file differing per template. The
division into issues holds. Second, the next-steps block has to name **two** servers with
different jobs (the app on its own port, the DevTool on 4200); printing both without saying
which is which is how a first-hour user lands on a blank page, and both entry paths print it.
Third, an asymmetry the prose hid: in a Next.js app init can mount a real route, because App
Router conventions make the location knowable, but in a plain-Node app it cannot edit an
entrypoint it did not write — so init there delivers a **second process**, not an integrated
route.

**Changed:** added theme 5's second half (one next-steps block, authored in FIX-1159, reused
verbatim) and theme 6 (init is additive, with the three named in-place edits). Both came out
of drawing the diffs; neither was visible in prose.

### Template A — Next.js chat app

```
my-app/
  app/
    api/flows/[...path]/route.ts   createNextHandler(<default export of fsdev.config.ts>)
    page.tsx                       chat UI, @flow-state-dev/react
    layout.tsx
  flows/
    chat.ts                        defineFlow — one action, one generator
  fsdev.config.ts                  default-exports createFlowState({ flows })
  .env.local                       OPENAI_API_KEY=…
  AGENTS.md                        written by init — see §5 Q1
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
  fsdev.config.ts
  .env.local
  AGENTS.md
  package.json                     @flow-state-dev/{core,engine,node,cli}
  tsconfig.json
```

### Diff — `fsdev init` into an existing Next.js app

```
  my-existing-app/
+   app/api/flows/[...path]/route.ts
+   flows/hello.ts
+   fsdev.config.ts
+   AGENTS.md
~   package.json     deps +@flow-state-dev/{core,engine,next,react,cli} · scripts +"fsdev"
~   .gitignore       +.fsdev/
~   .env.local       +OPENAI_API_KEY=   (created if absent, appended if present)
    app/api/billing/route.ts        untouched
    app/page.tsx                    untouched
    next.config.ts                  untouched
```

### Diff — `fsdev init` into an existing plain-Node app

```
  my-existing-api/
+   src/fsdev-server.ts             serve(…) — a second process, run alongside yours
+   flows/hello.ts
+   fsdev.config.ts
+   AGENTS.md
~   package.json                    deps +@flow-state-dev/{core,engine,node,cli}
~   .gitignore                      +.fsdev/
~   .env.local                      +OPENAI_API_KEY=
    src/index.ts                    untouched — init does not edit an entrypoint it did not write
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
$ npx fsdev init

  Detected  Next.js 15 (App Router)  ·  package manager: pnpm
  Adapter   @flow-state-dev/next

? Model provider ›  OpenAI
? OPENAI_API_KEY ›  found in .env.local — using it

  Created   app/api/flows/[...path]/route.ts
            flows/hello.ts
            fsdev.config.ts
            AGENTS.md
  Modified  package.json   (+5 dependencies, +1 script)
            .gitignore     (+.fsdev/)

  Nothing else in this project was touched.

  Next steps

    pnpm dev             your app, now serving /api/flows/*  → http://localhost:3000
    pnpm fsdev dev       the FSD DevTool                     → http://localhost:4200

    pnpm fsdev run hello send --input '{"userId":"u1","message":"hi"}'

  AGENTS.md tells your coding assistant how to write FSD flows.
```

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| FIX-1159 | `fsdev init` — wire FSD into an existing project (incl. the next-steps block and DevTool discovery) | spec | — | — | Backlog |
| FIX-548 | `create-fsd-app` — npx-able scaffolding, a thin wrapper over init, two templates | spec | — | — | Todo |
| FIX-1160 | Consumer authoring pack — agent-instructions file + Claude Code plugin | spec | — | — | Backlog |

All three are Feature-labelled, so all three take the spec route and each carries its own
spec-approval gate. FIX-1159 lands before FIX-548 (theme 1).

## 5. Open cross-cutting questions

Both entries below need the product owner's call. Neither blocks: every issue can be specced
against the recommendation and folds if the answer differs.

### Q1 — What filename does init write the agent instructions to, and what happens when one is already there?

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

**My recommendation: write `AGENTS.md`, and never overwrite.** If the file exists, append a
delimited FSD section and say so in the output; if it does not, create it. Pickup is the whole
point of the objective's second clause, and a file nothing reads fails that clause silently
rather than loudly.

**What would change my mind:** evidence that appending to a project's `AGENTS.md` degrades how
assistants follow the rest of it, or a design partner who says a tool writing to that file is
unacceptable regardless of care.

**Cost of being wrong.** Choosing `AGENTS.md` and being wrong is noisy and recoverable — a
developer sees a diff in a tracked file and deletes it. Choosing the namespaced file and being
wrong is quiet: FIX-1160 ships, nothing reads it, and the objective's second half is unproven
while looking done.

**Resolution:** *(open)*

### Q2 — Is the Claude Code plugin publicly listed at launch, or install-by-URL only?

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

**Resolution:** *(open)*

---

## Epic evolution

- **Epic drafted** — three issues under one outcome: a stranger reaches a streaming AI feature
  in their own project from one command, and their coding assistant writes FSD code that runs.
  Scoped `create-fsd-app` down to a thin wrapper over `fsdev init`, and recorded the accepted
  cost of shipping two templates instead of one.
- **After the inline end-state sketch** — added theme 5's one-next-steps-block clause and
  theme 6 (init is additive, three named in-place edits), because drawing the two diffs made
  visible what the prose had not: both entry paths print the same block, and the risky half of
  init is exactly three files.
