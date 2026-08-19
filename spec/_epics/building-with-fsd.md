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

**Proof** — what a person observes, carried by the issues' own goal checks with no new measurement
apparatus. **Each issue owns how its check is built**; the conditions those checks must satisfy are
theme 9's (the dependency rule and the runtime floor) and theme 6's (the additive guarantee), so
they are stated once there rather than twice here.

- *FIX-1159, mounted-route path* — an agent adds FSD to an existing Next.js app, a real model
  streams back **over the mounted HTTP route** (theme 9 (b): a `fsdev run` check passes while the
  bundled route is broken), the app's own routes still answer, and nothing the developer wrote has
  changed. **And the same request without the credential is refused, with no model invocation** —
  the negative half is not optional here, because **this is the one path where the credential is
  the only control.** Greenfield has the loopback bind and the second-process path has its own
  rail; the mounted route has nothing else. If the generated wiring omits or misconfigures the
  resolver, `defaultBodyUserIdPrincipalResolver` accepts the request and streams happily, so the
  positive check passes **identically whether the wiring is correct or entirely absent**.
  Asserting no model invocation is the second half that matters: a 200 carrying an error body
  would otherwise read as a refusal. **And the run must be against a host that already has its own
  `fsdev.config.*`** — the guest branch, where the registration line is applied rather than handed
  back. That is not a variant of the same check: `resolveRuntimeSource` returns on a located config
  *before* `discoverFlows` runs, so on a host with a config the flow file we author is never
  imported, and a proof run against a config-less project would pass while the supported branch
  reaches nothing we wrote (theme 5). **That fixture must carry at least one pre-existing flow of
  the host's own, and the run must assert it still serves afterwards** — without a bystander, "our
  refusal fires" and "their app is now dead" are the same observation, which is how the first
  version of the credential refusal passed while taking down the host's config. **And its resolver
  must be one that does not serve our pinned model**, so the demo's failure surfaces as a refusal
  with remediation at install time rather than as the developer's first broken request.

  **What this fixture cannot prove is theme 8's production refusal, and requiring it here was the
  fifth instance of a check that cannot fail — sitting inside the fix for the fourth.** The previous
  revision had this same fixture, built and started in production mode, "show the production refusal
  applying to *our* flow while the host's own flow still serves." Two independent reasons make that
  unobservable. Our demo flow carries a **per-flow credential resolver** on the guest branch (theme
  5), so under theme 8's own predicate it is *authenticated* and the refusal never reaches it — what
  refuses an uncredentialed request is our resolver, identically in development and production,
  whether the production guard is correct, wrong, or entirely absent. And the refusal's carrier is
  **the generated config**, which the guest branch by definition does not write. The check was
  therefore green against an absent guard and against every wrong predicate alike, which is the
  contract in `docs/architecture/authentication.md:122-132` going unvalidated while looking proved.
  **What the fixture does prove stays, relabelled to what it is:** an uncredentialed request to our
  flow is refused **by our per-flow resolver**, no model invoked, while the host's own flow still
  serves — the credential rail and theme 6's additive promise, not theme 8's guard.

  *The author branch **can** carry the guard's own scenario, and an alarm raised here that it could
  not is withdrawn on measurement rather than on argument. The host-level resolver that branch
  installs is invisible to the guard, which is a **true** false positive — but it is awkward, not
  impossible: `--allow-unauthenticated` binds the app, and a hand-written entrypoint calling
  `serve()` skips the guard entirely. Theme 8 carries the measured behaviour, both escapes, and the
  hazard the sanctioned escape creates; the fixture shape is stated there and the branch it runs on
  follows from §5 Q7.*
- *FIX-1159, second-process path* — the same against an existing plain-Node project: the printed
  command starts FSD, a call to it **carrying the generated credential** streams a real model
  response, and the project's own server keeps running. **A call without it is refused, and the FSD
  server is asserted to be listening on loopback only** — a connection attempt to it from a
  non-loopback address must fail to connect. **Both halves are required because this topology is the
  one with two controls and each can be dropped without the other noticing:** the per-flow resolver
  makes every registered flow authenticate, so `assertNetworkBindIsAuthenticated` returns early and
  **permits** a non-loopback bind — an implementer who drops `--host 127.0.0.1` gets no complaint
  from the guard, and a credential-only proof passes unchanged. **This must not be dropped as redundant with the run above.** It is a different
  host and a different shape (theme 8), and **if Q6 lands on one template it is the epic's only Node
  coverage of any kind** (and it is load-bearing either way) — without it, Node detection and the second-process instruction can be
  entirely broken while every other proof here passes.
- *FIX-548* — in an empty directory, `npm create flow-state my-app` plus the dev command it prints
  yields a streamed model response from the chat page the template ships, with the provider key
  supplied at the prompt the way a real user supplies it. **The same run must assert that
  `create-next-app`'s own `AGENTS.md` block and its `CLAUDE.md` survive the scaffold**, and that
  `.env.local` is genuinely ignored (`git check-ignore`, not a read of the file). **This too must
  not be dropped:** a streaming chat page proves nothing about what the scaffolder overwrote on the
  way there, and greenfield is the path where we author both sides, so it is the one place theme
  6's guarantee is exercised end to end. **And two negative assertions, because the controls on this path
  are otherwise proved only by the happy case.** A request from a non-loopback address must fail to
  connect (the dev bind). **And a third assertion is *pending §5 Q7 rather than specified***: the
  behaviour of an unauthenticated demo on a deployed app. An earlier revision required that the app,
  built and started in production mode on the default resolver, refuse a request to the mounted route
  before any model invocation — "the adapter-independent guard theme 8 requires". Theme 8 now records
  that no such guard exists on this path, so the requirement named a control we had not built and
  could not describe. It returns here as a written assertion once Q7 says what the behaviour is. The dev-bind assertion above stands on its own and was found by
  sweeping for the same defect as the mounted-route one: the bind is greenfield's *only* control in
  development (theme 8), and a chat page streaming over `localhost` proves nothing about it, because
  the page streams identically whether the dev script carries the flag or the exception was never
  implemented at all.

  **And the mirror of it, which is what a bind that cannot let go would fail — this one is
  unaffected by Q7 and stays as written:** the built app started in production mode **must be
  reachable from a non-loopback address**, and **`scripts.start` must be byte-identical to what
  `create-next-app` wrote**. Every other check here asks whether a control is present; none asked
  whether it *releases*. It needs no answer from Q7 because it asserts the **absence** of a
  narrowing we withdrew, not the presence of a guard we have not built — which is why it survived a
  round that struck the assertions around it.

- *FIX-1160* — one recorded run covering **both halves of the pack**: the plugin installed from its
  published source and a packaged skill invoked, then an assistant in a fresh project, given a
  stated feature goal and nothing else, produces a flow that runs. A single observation, stated as
  such, not a metric. **The plugin is inside the run because it is the brownfield path's delivery
  channel** — a check the scaffolded `AGENTS.md` satisfies on its own would pass while the plugin's
  manifest and install source sat unexercised until a stranger tried them.

**Two of these are now agent runs, and that changes what they are worth — this is an open item,
not a settled trade.** A seeded-sentinel check on an agent run is one observation, not a
guarantee — the same shape FIX-1160's proof always had. It is still the real path with a real
model and no new apparatus, which is what a goal check is for; it is not a claim that every
brownfield repo behaves.

**Attribution, stated exactly because an earlier round got it wrong.** The owner changed the
**delivery mechanism** — brownfield becomes an agent skill rather than a deterministic command.
That is theirs and it is settled. **The consequence for proof strength is the coordinator's
reading of that change, recommended and never put to them**: an enumerating command would have
given stronger per-case guarantees over a case list that never closed, and we accepted weaker
per-case evidence to escape the treadmill. Calling that "the trade the owner made" attributed a
judgement to someone who was never asked for it. **Reversible**: if the owner wants a
deterministic check back on either brownfield path, the way to get it is a fixture-based check
alongside the agent run, which costs a maintained fixture repo per host shape — the cost the
split was made to avoid. Filed here as an open item rather than a decision so it is visible at
the gate; it blocks nothing.

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
`create-flow-state` is registered and ours (published at `0.0.0`, verified against
`registry.npmjs.org`), so the headline command is a name we hold rather than a hope. What is left
of the case against it is the saved command alone.

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
- A second template **is not settled here either way — §5 Q6 is open and this section does not
  answer it.** *This entry previously read "v1 ships one; the Node API template is cut", which
  stated Q6's answer as a non-goal inside the section the objective gate signs off. Approving the
  epic would then have ratified one of Q6's three options — the one no longer recommended —
  without the reader knowing they were deciding it.* What **is** out of scope regardless of Q6:
  any template beyond the two under discussion.
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
   agent-instructions content FIX-1160 authors (theme 9 (c)) — so FIX-548 is last of the four.
   **FIX-1162 no longer gates FIX-548's
   spec or its build** — the names are held, so nothing is waiting on a decision. What it still
   gates is the *release*, and the gate is **not** "acquire a name": both `create-flow-state` and
   `fsdev` are registered at `0.0.0` to the owner's **personal** npm account (`jnhoffner`), not to
   an organization. **The release gate is that the identity CI publishes with can write to every
   package the quickstarts install** — the unscoped `create-flow-state` that `npm create flow-state`
   resolves to, and every `@flow-state-dev/*` the generated manifest declares. An org-scoped
   publishing token would fail on exactly the two packages both onboarding paths depend on, and it
   would fail on the first release rather than in review. It is an owner operation rather than agent
   work; **FIX-1162's worker is filing the `npm owner add` / transfer, so this theme states the gate
   and does not duplicate the mechanism.**

   **Two naming facts this gate rests on, kept here because nothing else carries them.** **`create-fsd-app` is not ours and never will be** — `create-fsd-app@1.1.2` is a React/Vite starter published 2024-10-18 by an unrelated maintainer (`keyready`), verified against `registry.npmjs.org`; any sentence implying we hold it is false. And **the `@flow-state-dev/` scope is not verified as ours**: nothing under it has ever been published, an npm scope belongs to whoever registers the matching organization first, and the obvious check cannot settle it — `/-/org/<name>/package` returns 200 with an empty body for scopes that exist and scopes that do not alike. **The cheap proof is publishing one scoped package at `0.0.0`**; until then two sibling specs lean on it as a fallback that may not be there.

2. **Template count — open (§5 Q6). Recommended: one Next.js chat app *plus* a minimal-project brownfield path; fallback: both templates.**
   **This reverses the earlier "two templates, and only two", and the reversal is *recommended,
   not yet decided* — it is the owner's call and they have not given it.** An earlier revision of
   this document recorded it as theirs. That was wrong, and the correction matters because an
   approval is being requested downstream: **FIX-548's spec is right to still carry it as its open
   ask, and this document was the one out of step.** The last written state anywhere is the
   cross-issue note of 2026-08-18 — *"the template ask is still open, and re-argued"* — and no
   record of an answer exists in any comment, unlike §5 Q2 and Q3, which were both recorded as
   owner decisions when they were made. **Everything below is written against the recommendation
   because the set has to be described some way; it is not evidence the question is closed.**

   *How it went wrong is worth one line, because the shape recurs: the evolution log entry bundled
   this with the scaffolder name — "Owner decisions folded — one template, and the name" — and the
   name half **was** verified. A verified attribution carried an unverified one beside it, and the
   pair read as equally settled.*

   The argument for the recommendation is what the other decisions did to the Node template's
   contents. Once a plain-Node
   host gets no generated server entrypoint (theme 8) and no `fsdev` package script, the Node
   template's entire remaining delta over `npm init -y` is a `package.json`, a `tsconfig.json`
   and a better-named demo flow. The accepted cost that bought it — two starters to keep green
   on machines we do not control — did not shrink with it.

   **The asymmetry argument is real but no longer decisive, and Q6 records why.** Adding `node-api`
   later is additive and strands nobody; removing a published template later breaks invocations
   that exist. That still holds — but it answers *"is deferring cheap?"*, and once the
   `mkdir && <brownfield run>` substitute was struck, deferring stopped meaning "a lesser path
   later" and started meaning **no first-party path at all for backend developers in v1**. The
   file count was never the point and the asymmetry is not the whole of it either; **§5 Q6 carries
   the current derivation and its three options.**

   **What follows for the issues below, *if* Q6 lands on one.** FIX-548's proof runs once, not once per template.
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
   issue of its own. **And making it resolvable must not force a React major on a repo we were
   invited into.** `@flow-state-dev/devtool` declares `react`/`react-dom` as `^19` with no
   `peerDependenciesMeta`, while `@flow-state-dev/react` supports `^18.0.0 || ^19.0.0` — so a
   brownfield run against a React 18 app hits an npm `ERESOLVE` failure or a duplicated React under
   pnpm. **That is theme 6's line exactly**: upgrading a developer-owned dependency is not additive,
   and we do not get to do it to reach our own DevTool. **The peer is also unnecessary for what this
   epic promises.** The package ships *pre-built assets* that `fsdev dev` serves out of process; the
   consumer's React renders none of it. React is only load-bearing for the package's separate
   `./react` subpath — an embeddable component **no path in this epic uses and no next-steps block
   mentions**. So the fix is to stop demanding it of every consumer: mark those peers optional (or
   widen them to match `@flow-state-dev/react`), which is a manifest change in our own package
   rather than a change to what brownfield promises. **The promise is unchanged either way** — the
   DevTool a first-hour developer is told about is `fsdev dev` on `:4200`, and that never needed
   their React. It sits with FIX-1159 under this theme's "resolvable as well as known".

   **There is one next-steps block: one authored source in FIX-1159, embedded by
   both shippers and rendered per host** — the same steps, in the same order, saying the same
   things, with the commands rendered for the manager and topology the path is actually running
   against. A second *authored* copy is how the two entry paths start telling people different
   things. **How that single source reaches FIX-548, and what fails when it drifts, is theme 9** —
   this theme states the requirement, theme 9 assigns the ownership and the invariant.

   **The rendered output is deliberately not byte-identical, and requiring that was a defect.**
   Greenfield prints `npm run dev` / `npx fsdev dev`; a brownfield run against a pnpm repo must
   print `pnpm dev` / `pnpm exec fsdev dev`, because detection found pnpm. A literally shared
   rendering is wrong for at least one supported context, and the end-state sketch's transcripts
   always showed the two differing — the word "verbatim" contradicted our own illustrations.
   **What must not vary is the authored text**, which is why theme 9 makes both forms of variation
   declared: the package-manager values, and the host-topology conditional. **The process list is
   not invariant** — a mounted-route host and a second-process host genuinely run different
   servers, which is exactly what that conditional exists to express. What is invariant is that
   whichever servers the host ends up with, the block says what each is for, which port it lands
   on, and the caveats that go with it.

   **Securing the endpoint changes what the printed commands do, so the whole block is walked
   under the secured config — every cell of shipper × host, every line.** Theme 8's credential is not a
   change to one route; it changes the `FlowState` every printed command loads. Walked end to end:

   - **`fsdev dev` breaks unless the generated config says so.** The DevTool page loads, and its
     API actions then fail authentication, because `packages/cli/src/commands/dev.ts` injects
     **only** the fields a config explicitly declares under `devtool` — a `userId` and a
     `bearerToken`. The mechanism exists for exactly this case (its own comment: *"Injected into
     the DevTool page by serve() so a secured flow is debuggable without hand-editing DevTool
     settings"*), so **the generated config declares `devtool` from the same source as the
     resolver**. Both topology branches print `fsdev dev`, so this binds both.

     **Where the resolver is installed depends on who wrote the config, and that is not a
     refinement — the earlier "install at both levels, always" rule broke theme 6 in someone else's
     repository.** Three constraints meet here, all verified in the engine rather than reasoned
     about:

     1. **`assertNetworkBindIsAuthenticated` reads per-flow only.** It inspects each served flow's
        own `flow.authentication?.resolvePrincipal` and **does not go through
        `pickPrincipalResolver`** — so a host-level resolver is invisible to it. *(Worth noting as
        an engine observation rather than an epic decision: `pickPrincipalResolver`'s own docstring
        names two callers that "must never disagree", and the bind guard is a third reader of the
        same question that bypasses it.)*
     2. **Host-scoped `GET /api/flows/sessions` reads host-level only.** With no host resolver it
        takes the anonymous branch and **withholds every row belonging to a flow that
        authenticates** (`unauthenticatedFlowKinds` → `handleListSessions`).
     3. **A host-level resolver is inherited by every flow that has no override.**
        `pickPrincipalResolver` returns `flow?.authentication?.resolvePrincipal ?? hostResolver`.
        In a project that already runs FSD, that is **not an empty slot** — it is the default the
        developer's existing flows are already relying on.

     **Constraint 3 is the one that was missed, and it is live in a supported path rather than a
     corner case.** FIX-1159 explicitly proceeds when the project has its own `fsdev.config.*`:
     *"Not a collision — proceed. Write no config, write everything else, and hand back the one line
     that registers the new flow in theirs."* (FIX-1159 at `6b2c4093d`, the head this was read at —
     see the citation rule at the end of this theme.) So instructing that developer to add a host-level
     resolver would make ours effective for **their** override-less flows, whose browser and HTTP
     clients carry none of our credential — **their working app starts returning 401s, silently,
     because we were invited in.** That is theme 6's promise broken directly.

     **That quoted line is in conflict with this theme, and FIX-1159 owns the resolution.** Handing
     the registration line back leaves nothing we author reachable at all (the finding below). This
     theme states only the invariant — **the run applies the registration line, and a `devtool` block
     where none exists, as additive edits; the host-level resolver is never written** — and stops
     there. *What FIX-1159's decision 1 should say instead is that issue's to write; an earlier
     revision of this paragraph dictated the correction, which is the epic reaching into a child
     spec's approach. Flagged for routing, not edited, and quoted at the head it was read at per this
     theme's citation rule.*

     **And no host-level resolver can avoid it.** The obvious escape — install a host resolver that
     branches on `flowKind` and leaves other flows as they were — **is not available**, because the
     guard branches on resolver *identity*: `isDefaultBodyUserIdPrincipalResolver` is a brand check,
     and the default resolver's behaviour at this layer is *not to run the guard at all*. Any real
     function we install flips every override-less flow out of the no-enforcement branch, whatever
     it does internally. Checked before choosing, because a third remedy would have been better than
     either of the two obvious ones.

     **So the rule is keyed on inheritance — narrower than the authorship boundary it was first
     written as, and corrected below for the reason recorded there:**

     - **When the run writes the config (no existing one):** install at **both** levels. Ours is the
       only flow, so the host level harms nothing, the bind guard is satisfied, and session listing
       works.
     - **When the config is the developer's:** install **per-flow only**, in the flow file we
       author, and **never add a host-level resolver to a config we did not write.** The bind guard
       is satisfied (our flow authenticates); their flows keep exactly the behaviour they had.

     **The prohibition is on the host-level resolver specifically, not on touching their config**,
     because the hazard is *inheritance* — `pickPrincipalResolver` falls back to the host resolver
     for every flow with no override, so a host resolver reaches flows we never named. An edit that
     reaches only our own entry carries none of that. Stating the rule as "write no config at all"
     is a wider prohibition than the hazard supports, and that width is what made the guest branch
     impossible to complete — see below.

     **What that costs, disclosed rather than engineered around:** in the guest case the DevTool's
     session list will not show our demo flow's sessions, because constraint 2 withholds them while
     the host level stays theirs. The DevTool still runs the flow and shows its trace; the *listing*
     is the degraded surface. **That is the right trade** — a cosmetic gap in our own tooling
     against a stranger's working app returning 401. *One forward-looking note for the config we do
     write: its host-level resolver governs every flow added later that has no override, and the
     generated file says so, since the developer who adds the second flow is the one it surprises.*

     *Greenfield is unaffected throughout: it configures no resolver at all, so its flow stays in
     the anonymous set and its rows stay visible. **Re-keyed:** this is a requirement of **a demo
     that ships no browser client**, which today only the brownfield path has — not a fact about
     brownfield. Stated per path it is accidentally true and would silently stop being true the
     moment a starter ships whose demo is not a web page (§5 Q6 option (a)).*

     **"Same environment variable" is not sufficient, and the audit of it found a worse failure
     than a rename.** The generated config **reads the credential once into a single binding, and
     both the resolver — declared **per-flow**, per theme 8's statement of what the bind guard reads —
     and the `devtool` block reference that binding** — never two independent `process.env` reads — **and
     the run refuses when it is missing or empty** (in the flow file, per below, so the refusal
     exists on both authorship branches). Four ways the two
     sides diverge otherwise, all silent: a rename in one place; a `??` fallback on one side; a
     **partial declaration**, since `DevToolConnectionConfig` makes both fields optional and
     `fsdev dev` gates on `userId` **or** `bearerToken` being non-empty, so a config with an
     identity and an absent token passes the gate and then fails auth looking like a bad key; and
     the serious one — **an unset variable makes a naive equality accept everyone**, because a
     request carrying no credential compares equal to an absent expected value, so the flow reads
     as secured while being open. Refusing is what makes that unrepresentable, rather
     than a thing the reader has to remember. **And the refusal is itself asserted, in the form each
     branch actually takes** — because a mitigation nobody exercises is the defect it was written to
     prevent, wearing a fix's clothes. With the variable unset:

     - **Author branch** — the run **must fail at startup**.
     - **Guest branch** — the run **must start**, our flow **must refuse the request**, and **a
       pre-existing flow of the host's own must still serve**. The last clause is the load-bearing
       one: it is the only assertion that fails if an implementer regresses to an import-time throw,
       which is what the first version of this rule specified.

     *An earlier revision asserted startup failure on **both** branches, directly above the
     paragraphs explaining why that takes the guest's whole app down. The reasoning had been
     corrected and the check beside it had not — which is the defect shape, not a typo.*

     **The refusal is *split by branch*, and getting this wrong was the most severe defect in this
     theme.** The first version put a **startup** refusal in the flow file, reasoning that the flow
     file is the one thing we author on both branches — correct about coverage, and wrong about
     blast radius, which runs along a different axis: **whose module graph imports our flow file.**
     On the author branch our config is its only importer, so a throw takes down our demo and
     nothing else. On the guest branch the developer applies the registration line into *their*
     config, which makes our flow file a node in **their** graph — and `loadFsdevConfig` wraps any
     throw from that import into a config-load failure. Their CI and their production deploy have no
     `.env.local`, so our module throws, their config fails to load, and **every flow they already
     had stops working.** That is theme 6's promise broken in its most severe form yet: not a 401 on
     their endpoints but a hard startup failure of their app.

     **And the check confirmed it by observing the harm.** It asserted the throw fires on both
     authorship branches; the guest fixture has no pre-existing flows, so "the refusal works" and
     "the guest's app is now dead without `.env.local`" were the *same assertion*. A check cannot
     catch a blast radius it has no bystander to measure.

     - **Author branch — startup refusal, in the config we write.** Our app is the only thing that
       fails, and failing early is right when the credential is the only control.
     - **Guest branch — request-time refusal, inside our own flow's resolver.** The resolver reads
       the variable **lazily, per request**, and refuses when the expected value is absent or empty.
       That closes the naive-equality hazard at the point it actually bites — a request comparing
       equal to an absent expected value — without detonating at import. Our flow refuses; theirs
       are untouched.

     *This is the shape theme 6's behavioural clause exists for: nothing about the file rules
     changed, and the run would still have broken their app.*

     **And in the guest case the `devtool` block is not ours to write either**, since it lives in
     the config we deliberately do not touch. Traced rather than assumed: securing our flow per-flow
     while leaving their config alone would open a DevTool that cannot invoke our demo flow at all —
     worse than the empty session list, and the same class of "we secured it and broke the next
     printed line" that theme 5 exists to catch.

     **Handing both lines over does not work, and the reason generalises past the two lines.** The
     first draft of this bullet had the guest case hand the developer the registration line and the
     `devtool` block for their own config rather than writing either. Walked against the CLI, that
     leaves the branch unable to do anything at all until the developer edits their config by hand.
     **`resolveRuntimeSource` does not *prefer* the config — it is exclusive:** a located
     `fsdev.config.*` returns before `discoverFlows` is ever called. So the flow file we author is
     not merely outranked, it is **never imported**. The projections, none of which is the whole
     finding:

     - `fsdev run <demo-flow>` — the flow is absent from their registry; discovery, which would have
       found our file, does not run.
     - `fsdev dev` — same registry, so the demo is neither listed nor runnable; and with no `devtool`
       block, `hasField` is false and the DevTool page is handed no credential, so our secured flow
       stays uninvocable even once registered.
     - `fsdev serve` — passes `requireConfig: true`, which throws *before* discovery. There is no
       `--no-config` on `serve` at all.
     - A mounted handler backed by that config — same absent flow, so the route cannot expose it.
     - **Both flag-level escapes fail**: `--flow-dir` is rejected outright when a config loaded
       (`assertNoFlowDirWithConfig`), and `--no-config` discards the app's real wiring — stores,
       model resolver — which is the entire reason their config exists, so it runs a different app
       rather than the same one differently.

     **The generalisation, which is the finding: on the guest branch nothing we author executes until
     that registration line is applied.** Every bullet above is a projection of that one fact, and so
     is the credential refusal this theme moved into the flow file *specifically so it would hold on
     both authorship branches* — it holds, but only downstream of a step we had left to the
     developer. **A standing check that must be run "on both authorship branches" therefore had a
     guest arm that could not be run**, which is a worse shape than the false passes this epic has
     been finding: those returned the wrong answer, this one has no answer to return.

     **So the run applies the registration line, and this is a change of mind about the boundary
     that should be recorded as one.** What changed it: the boundary was formulated as *authorship*
     — do not write a config we did not author — but the hazard it was built from is *inheritance*,
     and inheritance is a property of the host-level resolver alone. Generalising one flow-reaching
     hazard into a whole-file prohibition is what produced an unreachable branch. Keyed on the
     hazard instead, the config falls under **theme 6's additive contract like every other file we
     did not write**: appending our flow to the registry removes nothing, reorders nothing, and
     changes no existing key's value — the same standard already applied to `.gitignore` and
     `package.json`, neither of which we authored either. The developer's diff review is the consent
     surface, exactly as it is for every other write. **The host-level resolver stays prohibited**,
     because it is the one edit that reaches flows we never named.

     - **Flow registration** — additive, reaches only our entry. **Applied by the run.**
     - **The `devtool` block — absent: applied. Already present: handed over.** The block is
       **app-global in the type**, not per-flow: `DevToolConnectionConfig` is `{ userId?,
       bearerToken? }` on `meta.devtool`, one per app, injected as a single
       `window.__FSD_DEVTOOL_CONFIG__` and used for **every** flow the DevTool talks to. That is why
       overwriting an existing one is out — their DevTool identity is a real conflict, not a
       formatting one, and exception (b) forbids changing a key we do not own.

       **But absent is not the same case, and treating them alike was wrong in the expensive
       direction.** With no block present there is nothing of theirs to disturb: their DevTool has no
       configured identity today, so writing one sets a development-tool default rather than
       displacing a choice. Withholding it, meanwhile, breaks the advertised path outright — the
       standing check below requires `fsdev dev` to answer an **authenticated** API call, and without
       the generated token the DevTool cannot invoke our secured demo flow at all. **A rule that
       fails a check this theme itself mandates, and a next step we print, is not a cautious rule.**
       **Disclosed in the diff:** while the block is ours, the DevTool sends our generated `userId`
       to *their* flows too, so sessions created through it land under that id until they change it
       in DevTool settings — development-only, visible, and reversible in the UI.
     - **Host-level resolver** — inherited by their override-less flows. **Never.**

     *So the run applies **two** edits to a config it did not author — the registration line, and a
     `devtool` block only where none exists — and withholds the third. That is the boundary, and it is
     narrow because each candidate had to earn it separately: the `devtool` block was excluded for one
     round on the strength of its type being app-global, which is the right reason to refuse
     **overwriting** one and the wrong reason to refuse **writing** an absent one.*

     *This sentence said "the registration line is the only edit" for one round after the bullets
     above had already been corrected, and an implementer following it would have omitted the bearer
     token and failed the mandatory authenticated `fsdev dev` check. Recorded because the shape is now
     this document's most common defect and it is not a wording slip: **a correction was applied to
     one member of a pair.** The fix is to grep the *premise* — "what does the run apply?" — rather
     than the sentence that was wrong, and to re-read every site the premise reaches.*

     **What survives this fix — and the general question that generates the list.** `modelResolver`
     is a single **app-level** option on `createFlowState`, so on the guest branch our demo flow
     generates through *their* resolver, while FIX-1159 pins a concrete `provider/model` string in
     the flow we write. Each decision is right alone; **the pair produces a hardcoded model running
     through a resolver we do not own**, and if it does not recognise that ID the mounted route and
     every printed CLI command fail before streaming — so the guest proof cannot pass at all.

     **The resolver cannot be asked what it supports.** Checked rather than assumed: `ModelResolver`
     is `(modelId, blockName?, options?) => GeneratorModel` plus `resolveId(modelId, options?)`.
     There is no `supports()`, no enumeration, and no capability surface — and because provider
     packages load lazily, even a resolution that *returns* is not proof the model will generate.
     **So "confirm against what the resolver supports" is not implementable**, and the remedy is the
     honest one: **the run invokes the demo flow once, end to end, before it reports success, and
     refuses with remediation naming the resolver if that invocation fails** — the developer may
     supply a model ID their resolver does serve. This needs no new mechanism: the standing check
     below already runs what the block prints. What is new is that it must run **against a guest host
     whose resolver rejects our model**, which nothing currently does.

     **The class, because two independent workers hit it tonight: category enumeration passes each
     rule in isolation and the *pair* is wrong.** Standing question, applied whenever we change what
     we install into a host we do not own — **what else do we pin that the host also decides?** The
     live candidates, none of them closed:

     - **The provider credential's variable name** — same root as the model; their resolver may use
       a provider we never prompt for.
     - **The store.** App-level like `modelResolver`, so the demo's sessions land in whatever store
       their config opened, not the development one the author branch documents.
     - **Module format and the 22.18 runtime floor.** Our flow file is TypeScript imported by *their*
       config, so their `"type"` field and their Node version decide whether it loads at all — and
       the floor is a rule we state while they own the runtime.
     - **`handleExecuteAction`'s principal path**, which no read has yet enumerated.

     *Also unresolved rather than absent: the guest whose config already declares a `devtool` block
     still ends the run with a manual step (see the `devtool` bullet below).*

     **This is the fourth consequence to fall out of the resolver work** — DevTool listing, the
     additive-promise break, this, and the model-resolver gap above. Each fix was correct and each
     exposed the next, which is evidence about the *area* rather than about any of the fixes:
     changes to who-installs-what keep reaching further than the edit that motivates them, so the
     next one should be assumed to exist rather than hoped against.
   - **`fsdev run` is unaffected**, on both branches: it calls `runAction` in-process with its own
     `cli-user` identity and never resolves a principal, so it does not cross the secured surface.
   - **The second-process branch's own call does cross it.** `fsdev serve` starts a real HTTP
     server, so the example call the block prints — and §1's proof of that path — carries the
     credential.
   - **And what securing the flow does to the bind rail depends on *where* the resolver is
     declared** — see theme 8's statement of the guard's predicate, which is the single place it is
     written down. Declared per-flow, the guard sees it and a bind it used to refuse is now
     permitted; declared only host-level, the guard does not see it and refuses exactly as before.
     The printed command keeps `--host 127.0.0.1` either way.

   **So the printed block is under a standing goal check, not a rule that fires when someone
   notices.** Every command the block prints is run against the emitted project, on **both**
   cell of **shipper × host** (below), and asserted on **real behaviour rather than
   exit status** — the DevTool page
   answers an authenticated API call, the printed flow invocation returns a streamed model
   response, the second-process call is accepted with the credential and refused without it. It is
   a standing check because "re-walk the block whenever a decision changes the `FlowState`" is
   itself a rule waiting on someone spotting the trigger, which is the failure class this epic has
   now hit four times, one level up. **The standing check subsumes that trigger, so the trigger is
   gone rather than kept alongside it** — two rules covering one hazard is how the weaker one
   becomes the one people rely on.

   **The axes are shipper × host, and getting this wrong left greenfield exempt from its own
   block's check.** The first version keyed the check to *topology* × *authorship* — both of which
   are **brownfield-internal** — while theme 9 gives this same block a **greenfield shipper**.
   Greenfield therefore had no cell: its rendered block was exercised by one line, and FIX-548's
   shipper-side check is text equality against the canonical source, which cannot notice that a
   printed command does not run.

   - **Shipper** — the greenfield template, or the brownfield install skill. Decides who renders
     the block and what it can assume about the project.
   - **Host** — the shape in front of us: a Next-style app taking a `mounted-route`, or a plain-Node
     project taking a `second-process`; and for brownfield, whether the config is **ours or theirs**,
     which decides what the run installs and therefore what the printed commands can do.

   **Three live cases sat inside the old exemption**, none of them exotic: `npx fsdev dev` throwing
   *"DevTool assets not found"* when the template's devtool declaration is missing or mis-versioned;
   the **two-process filesystem-store race** that §1 lists among the defects that killed the
   deterministic command, still reachable because both `npm run dev` and `npx fsdev dev` are printed;
   and package-manager rendering, where this theme's only greenfield illustration hard-binds npm
   while the value is supposed to come from detection — a brownfield artifact greenfield does not run.

   **And the sentence that made the exemption feel principled is withdrawn: *"greenfield can always
   run what it just wrote."*** True of the files the template writes. False of `fsdev dev`, which is
   a separate package resolved at run time. **A shipper that authored the project still has to run
   what it prints** — authorship covers the files, not the commands.

   *`second-process` × guest remains the combination most likely to be dropped as exotic, and it is
   the one where the fewest of our files exist — now one cell among several rather than the only
   one anyone remembered to name.*

   **The finding that earns it, stated as the reason rather than as a fixed bug: securing the flow
   silently removed a rail.** Configuring a resolver **where the guard can see it** satisfies
   `assertNetworkBindIsAuthenticated`, so adding a control **took one away** — a bind that had been
   refused is now permitted. Nobody asked about that, no review reported it, and no check in the
   epic would have caught it; it surfaced only because the commands were walked one by one. A
   control that removes another control is not a rare shape, and running what we print is the
   cheapest thing that sees it.

   **The bind guard's predicate, stated once here because two findings now turn on it and a
   paraphrase got one of them wrong.** `assertNetworkBindIsAuthenticated`
   (`packages/node/src/bind-guard.ts`) returns early for a loopback host or an explicit override;
   otherwise it resolves the runtime and inspects **each served flow's own
   `flow.authentication?.resolvePrincipal`**, counting a flow as unauthenticated when that is
   `undefined` **or** is the default body-`userId` resolver, and refusing the bind by naming those
   flow kinds. **It is per-flow. A host-level resolver passed to `createFlowState` is not what it
   reads.**

   **Consequence, and the reason this is a correction rather than a note:** an earlier revision had
   the generated credential configured host-level in `fsdev.config.ts` while also claiming the
   guard would then permit a non-loopback bind. Both cannot hold. **So the generated resolver is
   declared per-flow, on the demo flow itself** — which is independently the right place, since
   `docs/architecture/authentication.md` keys its own guard on *the governing flow's* resolver too,
   and it makes the two guards agree instead of disagreeing silently. **The direction of that error
   is worth recording: it failed *safe*.** The guard would have refused where we said it would
   permit, so a developer met an unexpected refusal rather than an unexpected exposure — the
   opposite of every other defect this document has had, and the reason it survived unnoticed.
   *Whether the per-flow requirement is itself the right design is not this document's question;
   nothing here proposes relaxing that guard.*

   **The companion rule, which cost us three more findings before it was written down: every
   control is proved by its own absence, not by its presence.** A check that only exercises the
   protected case passes identically whether the control is installed or missing — so the scenario
   that motivated the control is exactly the scenario the check cannot fail in. Each control this
   epic claims therefore carries a negative assertion: the mounted route refuses an uncredentialed
   request **and invokes no model** (a 200 with an error body is not a refusal); the greenfield dev
   server refuses a non-loopback connection; the generated config refuses to start with the
   credential variable unset; and **the unauthenticated-demo rail is exercised by its own absence** —
   whose assertion is **pending §5 Q7**, since the rail as implemented keys on bind address rather
   than environment, refuses whole-app rather than per-flow, and is never invoked on either path this
   epic ships. *An earlier revision asserted here that "the production refusal fires" with the app
   built and started in production mode. Nothing implements that, so the assertion named a control
   rather than a behaviour — the same defect one level up from the ones this bullet exists to catch.*

   **That last one was missing when the control shipped, one round ago, and it is the seventh
   instance of this defect** — the round that added an adapter-independent production guard wrote
   no check that could detect its absence, so the guard could have been entirely absent with every
   mandatory check still green. **The standing test, stated as a procedure because "prove the
   negative" was evidently not operative enough:** name the scenario that motivated the control,
   say what the check returns *in that scenario*, and if the answer is "pass", the check is wrong.
   Applied here — scenario: the generated app is deployed with no authentication configured;
   returns: a refusal naming the missing authentication, and no model call. Applied to the version
   that shipped: the scenario returned "pass", because nothing ran the app in production mode at
   all.

   **And the timing is the part worth keeping: adding a control creates a new opportunity to
   under-prove it, and the round that adds the control is the round least likely to notice** —
   the author has just convinced themselves it works, and writes the check that shows it working.
   Every one of the six findings of this shape this epic has had was caught by a reader rather
   than by the author; three of them landed on fixes made in the same session, not on old text.
   Treat a newly added control as **unproven until its negative case exists**, however convinced
   the round that added it happens to be.

   **A printed command is checked against the CLI's actual flags before it ships.** Twice now a
   command in this document could not have done what it appeared to: `fsdev run` takes the caller
   identity as its own parameter (hard-coded `cli-user`) and **not** from `--input`, so a `userId`
   key in the payload sets nothing and teaches a first-hour reader a wrong mental model — and our
   published CLI docs already show `-i '{"message": "…"}'` without it. Both entry paths print these
   commands, so this is theme 5's rather than either issue's.

   It sits with FIX-1159 because the constraint that makes rendering hard is the brownfield one:
   **a next-steps block must not print a command the project cannot run**, and brownfield meets
   hosts whose package manager and topology it must detect. **That is a claim about *rendering*, and
   it does not exempt greenfield from *running* what it prints** — `fsdev dev` resolves a separate
   package and its assets at run time, so authoring the project proves nothing about it. Every
   shipper runs what it prints; see the shipper × host check above, which exists because this
   sentence previously ended "and greenfield can always run what it just wrote."

6. **A run is additive over files it did not author, and what makes that safe is review of what
   actually changed — not an enumerated file list.** The old boundary was a fixed four files plus
   the lockfile, and §1 records why it kept growing. **What survives is the guarantee, not the
   list — and it binds both entry paths; only the enforcement differs.** Brownfield holds it as
   the skill's instruction, with detection reporting what it found and the developer reading the
   diff before accepting. Greenfield has no diff review, so it holds it in the template's
   checked-in contents and in the report the command prints — which is why §1's greenfield proof
   compares that report against the actual diff.

   **And the guarantee is about *behaviour*, not only files — a distinction that cost a P1.** A run
   can satisfy every file rule here and still break the project: instructing a developer to add one
   host-level resolver line to their own config would leave every file boundary intact while
   turning their existing flows' working clients into 401s, because an override-less flow inherits
   the host resolver (theme 5 traces it). **A change we merely *recommend* into a file we do not
   write is still our change** where its effect is concerned. So the test is not "did we write
   outside our files" but **"does anything the project already had behave differently after this
   run"** — and where the honest answer is yes, it is a stated exception or it does not ship.

   The rules below are the same on both:

   - **Never overwrite a file it did not author, and never rewrite content it did not author.**
     Where a file already exists, add a delimited FSD section and leave everything else exactly
     as it was. That is what makes taking the shared `AGENTS.md` filename safe (§5 Q1).

     **The rule has exactly three exceptions, and they are enumerated here because a binding rule
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
     must add dependencies to it. There the invariant is **structural preservation, which is
     semantic and not textual**: every key we do not own keeps its value, and no key is removed or
     reordered in a way that changes meaning. **It explicitly does not promise the file's existing
     formatting**, because it cannot: the bullet below *requires* installing through the project's
     own package manager, and `pnpm add` and its siblings normalize whitespace and key layout while
     preserving every key and value. A guarantee of untouched formatting would forbid the very
     mechanism this theme mandates. What we own is the dependency entries, and `"type": "module"`
     where the template needs it. Lockfiles are the extreme case and are never written directly at
     all. `tsconfig.json` is **not** in the edit set for the chosen template shape, so it needs no
     rule here; an issue that finds it does has hit a cross-cutting question.

     **(c) The stock *development* serving script, greenfield only, narrowed to loopback.** *This
     exception has now been wrong in both directions. It was written for `dev` alone, which was a
     defect — we widened the contract for one key without asking what its siblings do. It was then
     widened to `dev` **and** `start`, which was worse, and `start` has since been **withdrawn**
     for the reasons directly below. `create-next-app` ships exactly three scripts — `dev`,
     `build`, `start` — `build` serves nothing, and `start` is no longer ours to touch, so the
     exception covers **`dev` only**.*

     **Why `start` was withdrawn. The harm is what settles it; the redundancy argument has since
     collapsed and the withdrawal does not need it.** *This paragraph read "redundant, and then
     harmful", with redundancy resting on theme 8's config refusal already covering production
     adapter-independently. **That control does not exist** — theme 8 now records the measured rail,
     which keys on bind address rather than environment and is never invoked on either path this epic
     ships. So `start` is **not** currently redundant against anything, and had the withdrawal rested
     on redundancy alone it would now have to be reconsidered.* It rests on harm instead, which is
     unaffected:
     because theme 6 asserted *"a platform deploy never runs `next start`"* — true of Vercel, and
     **false of Docker `CMD ["npm","start"]`, Render, Railway, Fly, Heroku and App Runner.** With
     `scripts.start` hard-bound to `127.0.0.1`, and `-H` carrying **no environment binding** so
     `HOST=0.0.0.0` cannot override it, the container binds loopback, the platform health check
     never connects, and **the app reads as dead with no error to read.** No check caught it: §1's
     greenfield production proof reaches the server over loopback, so it passes identically whether
     `start` was narrowed or never touched.

     **And it falsified the product statement**, which is the part that reached a person. *"The
     generated app does not serve off-host until its authentication is configured"* — configuring
     authentication lifts the config refusal but could never lift a hardcoded hostname, so the
     "until" resolved to *never*. **The corrected statement is in theme 8**, and it is true because
     the only production control is now the one that lifts.

     *`dev` keeps the exception and its original justification intact:* development is where no
     other control exists, and it is the one case where the justifying condition never clears —
     nobody configures production authentication and then keeps running `npm run dev`. `create-next-app`
     writes `scripts.dev`; the template rewrites its value to bind `127.0.0.1` (theme 8). **This is
     a third exception, stated as one rather than smuggled into (a) or (b), because it fits
     neither** — the script's purpose is to be *run*, not replaced, so (a) does not reach it, and
     (b) is exactly the rule it breaks, since we are changing the value of a key we do not own.
     Pretending otherwise would turn (a) into "anything `create-next-app` wrote that we find
     inconvenient", and the tightness of this set is the whole reason it is trustworthy.

     **What justifies it is that no other control exists *in development*.** The greenfield demo is a
     **browser** page calling the mounted route, so the credential that protects brownfield cannot
     protect greenfield: any token the page can use is a token anyone who can load the page can
     read, and on an exposed dev server the attacker can load the page. **Loopback is the only
     control that works when the client is a browser.** Against that, the alternatives are worse:
     printing `npm run dev -- --hostname 127.0.0.1` leaves the plain `npm run dev` that
     `create-next-app` itself advertises live and exposed, and adding a second script under a key
     we own does the same while also putting two dev commands in a four-second-old project.

     **The exception is deliberately narrow.** Greenfield only — a project we created, holding no
     developer content yet. **One key, `dev`**, whose stock value we caused to exist seconds earlier,
     and whose justifying condition never clears because nobody configures production authentication
     and then keeps running `npm run dev`. The edit
     only ever *narrows* a bind, breaks nothing, and is a one-word revert the developer can make.
     **It does not reach brownfield**, where the script is theirs, the project is theirs, and theme
     6's promise is the one the objective actually sells.

     **The production case is theme 8's, not this exception's — and theme 8 does not currently have an
     answer to it (§5 Q7).** `next start` defaults to `0.0.0.0`,
     and someone running `npm run build && npm start` is by definition not on their laptop — the same
     unauthenticated model-backed route on a real host, billed to them. That hazard is real; the
     answer to it *was* to be theme 8's config refusal, described as adapter-independent and as
     lifting when authentication is configured. **Neither property has been demonstrated and the
     control is unbuilt**, so this hazard is currently **open** rather than answered — it is the
     substance of Q7. Narrowing the script was tried and withdrawn above, on the ground that it broke
     every container and platform that starts an app with `npm start`; that ground stands whether or
     not a replacement control ever lands, but it leaves the hazard uncovered in the meantime, and
     saying so is better than implying cover we do not have.

     *Recorded because the reasoning is reusable: the lever we reached for was the one we already
     had permission to touch, not the one that fit the hazard. A script argument is a constant, and a
     hazard whose condition is expected to clear needs a control that can observe it clearing.*

   - **No credential is written until the path is verifiably ignored — a precondition, not a
     report.** Before writing anything secret, the run asks **git** whether the target path is
     effectively ignored (`git check-ignore`). If it is, write. If it is not, **append the rule**
     (an append to `.gitignore`, which this theme already permits) and re-verify, or **refuse the
     run** with remediation. Refusing on an already-tracked `.env.local` remains part of this — a
     tracked file cannot be rescued by an ignore rule — but it is now the narrow case rather than
     the whole guard.

     **Why the previous shape was unsafe, and why it matters more than when it was written.** It
     asked only whether `.env.local` was *already tracked*. In a repo where the file does not exist
     and no rule matches it, that check passes and the run creates an ordinary **untracked**
     file — and untracked is not ignored, so the next `git add .` commits it. **The file now holds
     two secrets, not one**: the developer's provider key, and since theme 8 the bearer secret we
     generate. A diff review does not reliably catch either, because they look like every other
     appended line.

     **The shape, because this is the third guard on this one file to be wrong: each checked a
     *proxy* for the property.** Tracked-ness, then delimiter position, now existence — none of
     them is "will git ignore this path", and only git can answer that. Inspecting `.gitignore`
     text is the same mistake one level down: a later negation pattern can re-include a path an
     earlier line excluded, so the file's contents do not settle it either. **Ask the tool that
     owns the answer.**

     **Negative-tested, both paths.** A fixture repo with no `.env.local` rule at all must fail
     before the fix and pass after. Greenfield asserts the same property with `git check-ignore`
     rather than trusting that `create-next-app`'s `.gitignore` covers it.
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

   **This guarantee is checked two ways on both paths, and the requirement is this theme's** —
   an open boundary cannot be checked by asserting a closed list survived, so every path's goal
   check seeds distinctive content into the files a run touches in practice *and* compares the
   run's own report against the actual diff. The report-versus-diff half is the stronger one: it
   catches a file nobody thought to seed. **Extending this theme to greenfield extended the
   requirement with it** — FIX-548's check asserts `create-next-app`'s `AGENTS.md` block, its
   `CLAUDE.md`, and the `.env.local` ignore survive the scaffold, which §1 restates because it is
   the one place the guarantee is exercised on a path we author end to end. A guarantee this
   document makes and no check exercises is worse than one it never made, which is why the
   requirement lives here rather than in the issues that implement it.

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
   requirement goes with the Node template if Q6 cuts it (theme 2)**: the second-process shape now appears in
   exactly one place, the brownfield Node path, so there is no second description to keep in step
   — and §1's second-process proof is its only check, which is why that proof got harder to cut,
   not easier. **The move to a skill does not soften this into a per-run judgement call:** the
   agent reads the
   host, but the *rule* is fixed here, and detection reports which host it found rather than the
   agent re-deciding what "knowable" means each time. **§1's proof runs this path directly**,
   because the other checks cover the Next.js path only, and nothing else touches the brownfield
   Node behaviour this theme commits to.

   **Neither arrival may put an unauthenticated flow on a network interface — and the rail that
   used to guarantee that does not reach the path we kept.** `docs/architecture/authentication.md`
   is explicit that an app on the framework default resolver
   (`defaultBodyUserIdPrincipalResolver`) trusts a caller-supplied `body.userId` and is protected
   only by "the loopback-bind rail in `@flow-state-dev/node`, which refuses to expose them on a
   network interface at all"; the rail and the guard are "a pair". **Everything this epic generates
   runs on the default resolver, and the mounted-route path never goes through
   `@flow-state-dev/node`** — it is `createNextHandler` inside the developer's own Next server,
   started by their own `next dev`, which binds `0.0.0.0` by default (verified in `next@16.3.1`'s
   CLI: `-H, --hostname <hostname>` … *default: 0.0.0.0*). The result is a demo flow that will call
   a real model with the developer's provider key, reachable by anyone on whatever network they
   are on.

   **The generalization, which is the part worth carrying forward:** the loopback rail is a
   property of **one host adapter**, not of FSD, so *any* path that reaches a flow through a
   different adapter loses it silently. The exposure was part of the case for cutting the Node template (Q6, still open) and it
   is present regardless in the path we keep, wearing a different adapter — which is the second time a safety
   property has been reasoned about per-template rather than per-adapter. **The rule is therefore
   stated once, here: a path that generates an unauthenticated flow must also generate the thing
   that keeps it off the network, and "the CLI does it" is only true of the CLI.**

   **Greenfield binds loopback; brownfield ships a credential. The two paths need *different*
   controls, and neither substitutes for the other.** The template rewrites `scripts.dev` to bind
   `127.0.0.1`, so the printed command is unchanged — the developer still types `npm run dev`. That
   is an edit to a key `create-next-app` authored, so it is **theme 6 exception (c)**, enumerated
   there rather than assumed here; an earlier round of this document wrongly claimed the script was
   ours to begin with. The cost is that testing the new app from a phone on the same wifi needs the
   flag removed, a one-word edit in a file we just wrote them.

   **Why greenfield cannot simply use brownfield's credential — checked against the template's
   actual data path, not assumed.** The chat page is a **client component** (`"use client"`) using
   `@flow-state-dev/react`, which wraps `@flow-state-dev/client`, which `fetch`es and opens SSE
   against `/api/flows/*` **from the browser** — verified against the reference app the template
   follows. There is no server component or route handler of ours in between holding a secret; the
   isomorphic client calling the mount *is* the shape, and a proxy layer would mean not using the
   React package at all. **So any credential that page can present is one an attacker can read by
   loading the same page, and on a dev server bound to every interface they can load it. A
   credential is not a control when the client is a browser** — loopback is not the cheaper option
   there, it is the only one. The mirror holds: brownfield ships no page, and its demo is exercised
   from the CLI and direct calls, so a server-side secret genuinely protects it.

   **The rule was always "on a network interface", and it had only ever been implemented for the
   dev server. That gap is the third form of one exposure** — the Node template's `serve()`, then
   `next dev`, now `next start` — and each was found separately because each was reasoned about as
   a *script* or a *template* rather than as the rule's coverage. **Binding scripts cannot finish
   it:** a platform deploy runs neither `next dev` nor `next start`, so no script we write is in
   the path at all, and the generated flow is on the default resolver there exactly as it is
   everywhere else.

   **PENDING §5 Q7 — this paragraph states a direction, not a mandate, and no issue implements it
   until Q7 is answered.** *It read as a binding instruction for several rounds after the measurement
   below established that the behaviour it describes does not exist and that the epic had no right to
   pick it. The narrative was corrected and the mandate was left standing — the same
   fix-applied-to-one-member-of-a-pair this document keeps hitting — so a child issue could have
   preempted the owner's decision by doing exactly what this sentence says.* The direction was: **the
   generated config refuses to serve a default-resolver flow outside development.** Same shape as the runtime floor — refuse
   rather than hand someone something that looks like it works — and it holds on every host,
   including the ones we never see. **This is owner-visible and stated plainly: a generated app
   will not serve in production until authentication is configured**, which for a demo scaffold is
   the correct default and is still a promise about what the thing does. The alternative is
   shipping a scaffold whose default deployment is an open model endpoint on the developer's bill,
   which is the same trade Q5 already refused for brownfield.

   **The resulting property, per entry path, in the same explicit form.** *Greenfield*: an
   unauthenticated caller elsewhere on the network **cannot reach the endpoint at all** — nothing
   is listening for them — and correspondingly, **nothing else stops them if the developer removes
   the flag**, since the flow itself accepts any caller. *Brownfield*: the endpoint **is** reachable
   and probeable, and every call without the secret is **refused** — no model invocation, no key
   spend, no acting as another user. **The greenfield template does not also carry a credential** — because *its* demo is a browser
   page, not because it is greenfield — and an earlier round claimed it did; it has the bind and no
   credential. *Per-topology, not per-path: see the
   control matrix below, which this sentence used to flatten.* **Brownfield cannot be fixed the same way** — theme
   6 forbids rewriting a `dev` script the developer authored, and printing a flag does not reach
   someone who starts their server from memory. **So the brownfield run configures a non-default
   principal resolver on what it generates.** That is the condition
   `docs/architecture/authentication.md` keys the framework guard on, so it is a real rail rather
   than a notice; the mechanism is FIX-1159's, and §5 Q5 records why nothing cheaper is available.

   **A disclosure is not a control, and an in-handler loopback guard is not available.** Both were
   examined and both are ruled out here so neither is re-proposed. *Warning only:* rejected — the
   architecture doc makes the loopback rail the protection for default-resolver apps, not an
   advisory, and a note in a diff does not stop a request. *A guard inside `createNextHandler`* —
   refusing a non-loopback peer when the default resolver is in play — was the more promising idea,
   because that handler is ours and it would have closed every adapter at once with no product
   decision. **It fails on availability of the signal, not on design:** a Next App Router route
   handler receives a web `Request`, and `NextRequest` in `next@16.3.1` exposes no peer address
   (`ip` is gone; `connection()` from `next/server` returns `Promise<void>` and is a prerendering
   signal). The only remaining inputs are headers, and a guard keyed on `x-forwarded-for` or `host`
   is bypassed by setting a header — worse than no guard, because it reads as protection. **It died
   on signal availability alone.** The other objections to it — that it would break Docker, WSL,
   devcontainers and phone testing without a deliberate opt-out; that it must key on the resolver
   rather than `NODE_ENV` so a deployed app is not loopback-only; that it needs a negative test from
   a non-loopback peer — were all answerable, and none was reached. **Anyone proposing it again
   needs a trustworthy peer address first; the design was never the problem.** **The rule this
   leaves is the general one: a path that cannot obtain a trustworthy peer address has to close the
   hole with a credential instead of a network position.**

   **Be exact about the property this buys, because it is not the property loopback buys.** With
   the credential, an unauthenticated caller is **refused**: no model call, no key spend, no acting
   as another user. What it does **not** do is stop the port listening — the developer's `next dev`
   still binds every interface, so the endpoint stays reachable and probeable by anyone on the
   network, and what protects it is the secret rather than the absence of a route.

   **The controls vary by *topology*, not by path, and stating them per path is how this document
   got it wrong twice in opposite directions.** An early round claimed greenfield had "both
   layers"; the correction — "one control each" — was right about greenfield and **over-generalised
   the other way**, flattening a per-topology fact into a per-path rule. The actual matrix:

   | | Loopback bind | Credential | Why |
   |---|---|---|---|
   | **Greenfield** (mounted-route) | **`dev` only** — theme 6 (c). **Production: unresolved, §5 Q7** — the row previously said "the config refusal", a control that does not exist | no | its demo is a browser page, so any token it holds an attacker reads from the same page |
   | **Brownfield, mounted-route** | no — their dev script, theme 6 forbids editing it | **yes** | the only control available |
   | **Brownfield, second-process** | **yes** — our printed `fsdev serve --host 127.0.0.1` | **yes** | **both**, because we author the start command *and* ship no browser client |

   **The generalisation that actually holds is not about paths at all.** A path gets the **bind**
   when *we author the command that starts the server* — greenfield's scripts, the second-process
   branch's printed command — and not when the developer's own command starts it. It gets the
   **credential** when *the demo ships no browser client to leak it*. Those two questions cut across
   greenfield/brownfield rather than along it, which is why every attempt to state this per path has
   been wrong.

   **A third question sits underneath both, and missing it is what produced the `start` defect: can
   the justifying condition ever clear?** For a development command it cannot — nobody configures
   production auth and then keeps running `npm run dev` — so a fixed bind is correct there. For a
   production command it clears the moment the developer does what theme 8 asks, so a fixed bind is
   wrong there *by construction*, whoever authored the command. The second-process branch gets this
   right for free because `assertNetworkBindIsAuthenticated` **is** the condition. The attempt to
   narrow greenfield's `start` got it wrong because a script argument is a constant and cannot ask —
   which is why that narrowing was withdrawn rather than made cleverer. **What covers production on
   each path is now open (§5 Q7)** — this sentence used to answer it with "the config refusal on
   every path", naming a control that was never built and, on the mounted route, could not have been
   built the way it was described. **A control
   whose condition can clear must be able to observe it clearing** — otherwise it is not a control,
   it is a permanent default wearing a rationale.

   **There is no product statement here, and the three that stood in this place were each withdrawn
   as false. This document does not make one again until the owner has decided what the behaviour
   is.** The history is the argument for the restraint: *"does not serve off-host until
   authentication is configured"* promised a lift a hardcoded hostname could never deliver; its
   replacement, *"refuses to serve its demo flow in production until real authentication is
   configured — once it is, the app serves normally wherever it is deployed,"* was relayed to the
   owner and is **also false**, for reasons measured rather than reasoned (below): nothing on this
   path keys on production, the refusal is not per-flow, and on both of this epic's entry paths the
   guard is never invoked at all. **Each version was written by reasoning from the rules to the
   behaviour, and each survived until someone ran the code.** The behaviour is now an open owner
   decision — **§5 Q7** — and the statement is whatever Q7 answers, written once and not before.

   **What may be said today, and it is a statement about our code rather than a promise about
   theirs:** the generated app is a demo scaffold on the framework default resolver, and the control
   that is supposed to keep it off a network interface does not reach either path this epic ships.

   **The rail as implemented, measured rather than reasoned — and it is not the rail this theme
   described.** Every previous version of this paragraph derived the predicate from the rules around
   it and was wrong. A POC settled it empirically: a real three-flow app (`open` on the default
   resolver, `bystander` properly authenticating, `demo` with a per-flow credential resolver) served
   through the real `serve()` from `@flow-state-dev/node`, with `assertNetworkBindIsAuthenticated`
   invoked exactly as `fsdev serve` invokes it, four configurations, real uncredentialed HTTP POSTs,
   byte-identical across two runs. **Four findings, all of which contradict something this document
   said:**

   1. **Detection is per-flow; enforcement is whole-app.** When the guard fires it refuses **the
      bind**, so the properly-authenticating `bystander` was equally unreachable even though the
      refusal message names only `open`. *"Flows that authenticate properly continue to serve" is
      false against today's code.* The any-flow blast radius is not one of several readings we could
      choose between — **it is what ships**, and no code path produces a genuine per-flow refusal.
   2. **The trigger is the bind host, not the environment.** There is no `NODE_ENV` check anywhere on
      this path in `engine`, `node` or `cli`. `fsdev serve --host 127.0.0.1` in production is fully
      exempt; binding `0.0.0.0` in development is refused. **"Outside development" corresponds to
      nothing implemented**, which is what made every product statement above false.
   3. **`serve()` never calls the guard.** `packages/cli/src/commands/serve.ts:109` is its sole
      caller; `packages/node/src/serve.ts` imports only `isLoopbackHost`. **So a host application
      that imports our flow and calls `serve(app, { host: "0.0.0.0" })` has the guard nowhere on its
      path** — and that is the shape of this epic's entire brownfield story. Combined with the
      mounted-route path never reaching `@flow-state-dev/node` at all, **neither entry path this epic
      ships is covered by the rail**, and this document has been specifying a completion of a control
      that was never on the path.
   4. **A credentialed flow carries zero information about the guard.** `demo` returned
      `HTTP 401 {"error":"demo: missing credential"}` identically with the guard present, with it
      **removed**, and in the per-flow-refusal variant — its own resolver produces the refusal in
      every configuration. What discriminates is `open`: with the guard removed it returns
      `202 in_progress` and the engine logs `userId: 'attacker'`, the default resolver trusting a
      caller-supplied body id. **That is the exposure, and it is the only thing worth asserting on.**

   **The minimum discriminating fixture, rebuilt from the evidence.** Two flows, invoked through
   **`fsdev serve` and not `serve()`** — the distinction is load-bearing, since the library path has
   no guard on it:

   - **(a)** the **default-resolver** flow is refused on a **non-loopback** bind — **red when the
     guard is removed**, which is finding 4's discriminator and the only assertion that sees the
     exposure;
   - **(b)** the **properly-authenticating bystander** is reachable — **red today**, by finding 1.
     It is written as an assertion rather than dropped precisely because it fails: it is the
     standing measurement of whether enforcement is still whole-app;
   - **(c)** both serve on `127.0.0.1` — pinning that the trigger is the bind host, per finding 2.
   - The credentialed demo flow appears only as a **control that must 401 in every configuration**,
     never as an assertion about the guard.

   **The host-level fallback, measured separately and settled: awkward, not impossible.** A second
   POC ran `executeServeCommand` — the function `fsdev serve` itself invokes — across five
   configurations on `origin/main @ f56c6b216`, with real credentialed and uncredentialed POSTs.
   **The guard does refuse a genuinely authenticated app**: a host-level resolver with an
   override-less flow on `--host 0.0.0.0` is refused outright, and the negative control proves the
   refusal is unwarranted — the same resolver moved to per-flow binds, rejects uncredentialed calls
   and serves credentialed ones. **The mixed case is the one this theme's fixture needs**: a host
   resolver, one overriding flow and one inheriting flow is refused naming only the inheriting flow,
   and **nothing serves, including the correctly-configured flow** — whole-app enforcement confirmed
   on exactly that shape. *An alarm was raised that this made the generated app unable to ever serve
   on a network interface. It is refuted:* **two escapes both verified** — `--allow-unauthenticated`,
   after which the host-resolver app binds *and still enforces auth properly*; and a hand-written
   entrypoint calling `serve()` from `@flow-state-dev/node`, where the guard never runs. What is
   **not** available is any host-level *configuration* that satisfies the guard: `createFlowState`
   exposes one auth field, the guard structurally cannot see it, and there is no config-file
   equivalent of the flag. Per-flow `authentication.resolvePrincipal` on **every** flow is the only
   way to pass on the merits. Documented as a known limit at `packages/node/src/bind-guard.ts:14-18`
   — **`packages/node`, not `packages/engine`**.

   **The hazard that survives is worse than the false positive, and it is a product problem rather
   than a framework one.** The sanctioned escape is a flag named **`--allow-unauthenticated`**,
   applied to a **fully authenticated** app, and it disables the guard **wholesale** — so a flow
   added later with no authentication binds silently, on an app whose operator believes the flag was
   a formality. That is priced in §5 Q7 rather than solved here. *A named minimum fix exists and is
   also priced there: pass the app's configured `resolvePrincipal` into
   `assertNetworkBindIsAuthenticated` and treat a flow as unauthenticated only when its **effective**
   resolver, per `pickPrincipalResolver`'s precedence, is undefined or default-branded. The framework
   defect is filed separately; this document prices options and does not choose the fix.*

   **Three declared gaps — unknown, not safe.** A flow declaring `authentication` with
   `defaultUserId`/`requireUser` but no `resolvePrincipal`, which the guard's undefined branch would
   still refuse; non-HTTP transports mounted as adapters under `fsdev serve`; and the fact that
   everything ran against TypeScript source via `tsx` rather than built `dist`. The Vercel/Next
   **serverless** adapters remain unmeasured too, where the rail is Node-only and a deployment-keyed
   refusal may have no meaning at all.

   **What the behaviour should become is not settled here — it is §5 Q7, where two forks are now
   settled by the coordinator (key on the bind address, not deployment; do the named minimum fix,
   filed as FIX-1189) and the remaining choice is the owner's.**
   Four questions fall out of the findings: whether the refusal is per-flow or whole-app; whether it
   keys on bind address or on deployment; whether the guard is taught to see a host-level resolver;
   and whether the library path is guarded at all. Each
   changes what a developer experiences, so each is priced in Q7 rather than decided in a theme.
   **No issue implements a production refusal before Q7 is answered.**

   **The second-process branch therefore has defence in depth, and that is a specified property
   rather than an accident** — theme 5 keeps `--host 127.0.0.1` in its printed command. **§1's proof
   of that path must assert the bind**, because nothing else will: the branch installs a per-flow
   resolver, so every registered flow authenticates, and `assertNetworkBindIsAuthenticated` returns
   early on `unauthenticated.length === 0` — **it permits a non-loopback bind.** Scenario: an
   implementer reads "brownfield has no bind" and drops the flag. What does the check return?
   **Pass** — the guard does not object and the proof only ever asserted credential acceptance and
   refusal. *Severity stated honestly: the credential still refuses unauthenticated callers, so this
   loses a layer we specified rather than opening the endpoint. It is a check that cannot fail, not
   an exposure.*

   **What each configuration leaves open, which is the honest comparison:** greenfield is
   unreachable off-host but unguarded if the flag goes; brownfield mounted-route is reachable and
   probeable but refuses every caller without the secret; brownfield second-process is neither
   reachable nor unauthenticated — and is the only one whose two controls can each be dropped
   without the other noticing, which is why both are asserted.

   **Two other rules were flagged as stated per *path* while their cause is something else. A
   non-author read has now settled both, and they resolve differently:**

   - **Theme 6 exception (c) — settled, and the *label* was the wrong part.** The enumeration is
     correct and measured: `create-next-app@16.3.1` with the pinned flags writes exactly `dev`,
     `build`, `start`. But (c)'s real key is not "greenfield" and not "we author the project" — it is
     **"a serving script a third-party scaffolder we invoke wrote, which we then narrow"**, which
     resolves identically on every Q6 branch. So relabelling decides nothing and Q6 does not mask it.
     **What is actually missing is an assertion:** nothing checks the script set, so a future
     `create-next-app` adding a fourth serving script under-covers (c) with every check still green.
     The check belongs where the template is generated — assert the scaffolder's serving-script set
     is exactly what (c) enumerates, and fail loudly when it is not.
   - **The credential rule — confirmed, genuinely Q6-dependent, and contradicted in three places.**
     Its cause is *the demo ships no browser client to leak the token*, not the path; theme 8's
     matrix already carries that generalisation correctly. Three other sentences still state it per
     path — theme 5's *"All of this is a brownfield-path requirement"*, this theme's *"greenfield
     does not also carry a credential"*, and Q5's *"greenfield does not also take a credential"*.
     Under Q6 option (a) they are **wrong** and must be re-keyed before a Node starter's demo is
     specified, or it ships open. Under (b)/(c) they are *accidentally* true, which is worse than
     being wrong in one way: they are exactly what a future reader generalises from. **All three
     are corrected in place**, since the correct key is true on every branch and states no answer
     to Q6.

   **The standing citation rule this theme now follows, because every defect of this shape has come
   from the same place:** this document's code-resting claims have held on every check; its
   claims about *sibling specs* have not, because a sibling moves without telling us. So **cite
   verified behaviour rather than a sibling's internals**, and where a sibling must be quoted,
   **name the head it was read at** — as Q6 does for the package-manager gate — so the next reader
   can tell staleness from disagreement.

   **The one option that would close it was considered and rejected, and the rejection is recorded
   here so the next person who notices the LAN gap finds an answer instead of reopening it.** That
   option is to stop mounting a route in a brownfield Next app at all and run it as a second
   process like the Node path, which would put it behind the CLI's loopback bind. **Rejected: it
   trades the epic's headline integration for defence in depth over a control that already
   works.** The mounted route is what makes brownfield feel like FSD is *in* their app rather than
   beside it, theme 8's greenfield/brownfield parity is built on it, and the credential already
   refuses the attack the gap describes — an unauthenticated caller gets nothing. Paying the
   product's most visible property to add a second layer over a working first one is the wrong
   trade. **Decided by the coordinator, not the product owner**, because both horns are engineering
   consequences of decisions the objective already made; it is recorded rather than escalated for
   the same reason Q5 resolved rather than escalating.

9. **Three shared artifacts, one seam: author, kind, carrier, check.** Three times this epic has an
   artifact authored by one issue and shipped by another — the wiring contract, the
   agent-instructions block, the next-steps block — and it solved the seam twice, differently,
   before being asked for a third. **The mechanism was then wrong five times**, with one diagnosis
   every time: each fix defended a *stored value* (a hand-incremented label, a canonical-only
   digest, a self-referential whole-block digest, the normalization that fix required, and finally
   a stripped marker nothing validated). Stored values are gone. **What this theme keeps is what
   genuinely spans issues — who owns each artifact, what order they land in, and the invariant every
   shipper must satisfy.** The mechanics of checking it belong to the owning issues; (d) says which.

   **Every shared artifact declares an author, a kind, a carrier, and a check.**

   - **Author** — the one issue that holds the knowledge. Every other issue is a shipper, and a
     shipper never re-authors.
   - **Kind** — a **specification**, where shippers produce host-appropriate output that *conforms*
     and the outputs legitimately differ, so the check is behavioural; or a **source block**, one
     canonical text embedded verbatim in every shipper's own source, so the check is text equality.
   - **Carrier** — how it reaches its shippers. Both already exist and neither is new: shippers live
     in this monorepo beside their authors, and the brownfield shipper is skill content, which
     reaches a stranger through the plugin FIX-1160 packages.
   - **Check** — **owned by the artifact's author**, because the author owns canonical. See (a).

   | Artifact | Author | Kind | Shippers | Check owner |
   |---|---|---|---|---|
   | Wiring contract | FIX-1159 | specification | FIX-548's template · FIX-1159's skill | FIX-1159 |
   | Agent-instructions block | FIX-1160 | source block | FIX-548's `AGENTS.md` · FIX-1159's skill, **embedded by FIX-1160 at packaging** — see (c) | FIX-1160 |
   | Next-steps block | FIX-1159 | source block | FIX-548's scaffolder · FIX-1159's skill | FIX-1159 |

   **(a) The author owns the comparison; each shipper runs it when it lands.** The normalization,
   the placeholder syntax and the comparison itself are **one implementation per artifact, owned by
   the issue that owns canonical** — so two shippers cannot drift apart on a normalization neither
   of them implements. Those mechanics were written out here across five rounds because that is
   where the defects were being found, not because they span issues; an epic-spec is a coordination
   artifact, and a renderer's syntax is not coordination. **What stays is the invariant, because it
   binds a shipper that does not own the check.**

   **But ownership of the comparison is not ownership of the *invocation*, and conflating them left
   the invariant unenforceable.** Authors land **before** their shippers — FIX-1159 and FIX-1160
   both precede FIX-548 — so an author-run check over a shipper's copy is impossible to write
   correctly: demanding the copy fails while FIX-548 has not landed, and tolerating its absence
   passes forever if FIX-548 never ships it. Neither can distinguish *not yet* from *never*.
   **Resolved by splitting the two: the author exports the comparison, and every shipper invokes it
   against its own embedded copy as part of its own test suite.** The check then lands exactly when
   the copy does, and a shipper that never embeds the block has no passing suite to hide behind,
   because the assertion ships with the thing it asserts on.

   **It must fail on a trimmed branch, not merely a missing file** — so the shipper's assertion is
   normalized **equality over the whole block**, every conditional branch included, never a
   presence or substring check. A dropped `second-process` branch changes the text and fails the
   comparison; a check that only asked "is the block here?" would pass on exactly the shipper-side
   damage rule 2 exists to prevent. **This adds no dependency between packages of the kind this
   theme rejects**: the comparison is a test-time import inside this monorepo, which is where every
   shipper already lives, and the alternative — each shipper reimplementing normalization — is
   precisely the drift the single implementation exists to stop.

   **The invariant, for source blocks.** A shipper embeds the canonical text **verbatim**, and its
   embedded copy is identical to canonical after the author's normalization. Everything that varies
   is a **declared substitution** or lives outside the delimiters — per-host prose outside, per-host
   values in named placeholders. **This is what three rounds kept conflating: the *file* varies, the
   *block* does not.**

   **Declared variation has two forms**, and the second exists because the first cannot express what
   theme 8 requires:

   - **values** — named placeholders replaced with a detected value (the package-manager commands);
   - **conditional sections** — a named region rendered only under one of theme 8's two topologies,
     `mounted-route` or `second-process`. **The key set is closed and lives here**, because theme 8
     fixes exactly two topologies; a block wanting a third key is a cross-cutting question rather
     than a shipper's call. The next-steps block needs this form: a mounted-route host runs its own
     dev server with FSD answering inside it, a second-process host starts `fsdev serve` alongside
     the server already there, and substituting a package-manager command cannot turn one process
     list into the other. Moving the process list outside the delimiters is not the escape — that
     returns the block's whole payload to unowned per-host prose, which is what theme 5 exists to
     prevent.

   **Every shipper embeds every branch and renders only its own.** FIX-548's scaffolder ships
   greenfield Next.js and never renders `second-process`, but the unrendered branch still sits in
   its source byte-identical to canonical, because that is what the author's check reads. **A
   shipper that trims a branch it cannot reach breaks the check** — stated here rather than in the
   author's spec because it binds the shipper, and trimming it looks like tidying.

   **(b) The wiring contract is the one specification, and this is its surface.** Its outputs
   genuinely differ — the template writes `flows/chat.ts` and a chat page, a brownfield Next run
   writes `flows/hello.ts`, a plain-Node run writes no mount at all — so conformance checked
   behaviourally is the only honest check. It is FIX-1159's because "what wiring FSD into an
   existing repo requires" is the knowledge it holds; **FIX-548 remains the set's only deterministic
   writer**, and writing the shape and specifying it are different jobs. It covers:

   - **the Next.js mount pair — two files, not one.** The engine registers `list_flows` as `GET /`
     on the mount base and `client.listFlows()` requests it, while a required catch-all needs at
     least one segment and would 404 there. Both in-repo mounts already pair the two and the
     published Next.js and Vercel guides teach the same shape, so a single-file mount is a third
     shape at odds with our own docs.
   - **`fsdev.config.ts`'s shape, including a declared store profile.** `stores` is a required
     option needing at least one named profile: `createFlowState({ flows })` alone does not
     typecheck and does not initialize, which would break every command the next-steps block
     prints. Which profile ships, and how it is labelled a development default, is the owning
     issue's call.
   - **a statically imported provider, passed as a pre-built `modelResolver` — not the `models`
     shorthand.** `createModelResolver` resolves providers through `createRequire` and a dynamic
     `import()`, and **Next bundles server code, which breaks that path**; our own published guide
     already says so and shows the fix (`apps/docs/guides/deploying-to-vercel.md`: *"Next.js bundles
     server code, breaking the model resolver's dynamic `require()` path. Pass a pre-built
     `modelResolver` with static provider imports"*). **Both entry paths mount into Next, so this
     binds both.** It is in the contract rather than either issue because it is the same wiring on
     both sides and neither can discover it from the other. **The failure it prevents is the reason
     it is stated here at all: the dependency rule can be fully satisfied — the provider package
     installed, the manifest complete, an isolated install green — and the first browser request
     still fails with `No provider available`.** Installing a package and being able to reach it
     through a bundler are two different claims, and only one of them had a check.
   - **the dependency set, which is a rule rather than a list**: *every package the generated files
     import directly is a direct dependency.* Two review rounds each found one missing member, which
     is why it is a rule. Today it reaches `zod` and the AI SDK for the selected provider.
   - **the runtime floor, which is `22.18` and not `22`.** Every FSD package declares
     `"engines": {"node": ">=22"}`, but that is not the binding number: both paths emit an
     `fsdev.config.ts`, and the CLI loads it with a native `import()` that needs **Node 22.18+**
     for type stripping (`packages/cli/src/load-config.ts`, whose own error text names 22.18). So
     **Node 22.0–22.17 passes a `>=22` check and then fails every printed command at config load**
     — the same failure shape as the Node 20.9–21 case, one interval higher. **Both entry paths
     check 22.18 before they write anything, and the guidance names 22.18.** A `.mjs`/`.js` config
     is the documented escape, but a path that emits `.ts` does not get to rely on it.

   **Both manifests are proved by an isolated (pnpm) install, and neither issue may substitute a
   static scan.** npm's flat `node_modules` hoists transitives, so an npm-only proof passes on an
   incomplete `package.json`; and a static import scan cannot see the provider SDK, which is
   resolved at run time rather than imported. **This binds the two issues symmetrically** —
   FIX-1159's brownfield manifest and FIX-548's greenfield manifest each need their own isolated
   install — and that symmetry is why the requirement is here while the reasoning behind it is each
   issue's to record.

   **Every mounted-route path is proved through the HTTP route, never through `fsdev run` alone.**
   The CLI runs in-process and resolves providers through the dynamic path that works there, so a
   CLI-only check passes with the product's actual path broken — which is exactly how the static
   provider wiring above could go missing while every other check stayed green. FIX-548's spec
   already reached this conclusion for its own goal check; **stating it in the contract is what
   makes it bind the brownfield Next path too**, whose proof would otherwise be a `fsdev run`
   command and nothing else.

   **(c) Ordering, and the one artifact that flows against it.** FIX-1160 authors the
   agent-instructions content the template ships, so **FIX-1160 lands before FIX-548**; without that
   edge a template landing first ships a draft that drifts. The second shipper created a cycle —
   FIX-1159's skill must emit the block too, but FIX-1159 lands *before* FIX-1160, which packages
   the skill. **Resolved by co-location: FIX-1160 owns the content *and* the embedding.** FIX-1159's
   skill carries a named placeholder and FIX-1160 substitutes the canonical block when it packages
   the plugin — the declared-substitution mechanism applied one level up, running along the existing
   FIX-1159 → FIX-1160 edge instead of against it. **Only this artifact has the cycle**, and the
   diagnosis generalizes: an artifact authored against the epic's dependency direction cannot be
   embedded by an issue upstream of its author. The other two are authored by FIX-1159 and shipped
   with the grain, checked rather than assumed.

   **Rejected, across all three, because each creates a coupling the package boundaries should not
   carry:** a build-time copy between packages; the plugin shipping a copy of the template (it makes
   FIX-1160 a second writer of the shape); and the skill reading the published `create-flow-state`
   at run time (legal under theme 4, since npm is not our monorepo, but it makes the greenfield demo
   app the authority for brownfield wiring). **No new package and no new dependency between
   packages** — the checks read files and compare strings at test time. Had the mechanism needed
   either, it would have gone to the owner rather than into this theme.

   **(d) What each issue owns, now that this theme has stopped carrying it.** Each is a spec change
   in the receiving issue, not a new deliverable:

   - **FIX-1159** — the next-steps block's canonical text, its placeholder and conditional syntax,
     its normalization and equality check; the wiring contract's content; the brownfield manifest's
     isolated-install proof. *Spec in review, so this lands in the current round.*
   - **FIX-1160** — the agent-instructions block's canonical text, its normalization and equality
     check, and the packaging-time substitution into FIX-1159's placeholder. *Approved spec —
     **needs re-taking**.*
   - **FIX-548** — embedding both blocks verbatim, every branch included (`second-process` among
     them, which it never renders); conformance to the wiring contract; the greenfield manifest's
     isolated-install proof and the runtime-floor refusal. *Approved spec — **needs re-taking**.*

## 3. Shape of the whole

**No end-state POC exists, and this section previously implied one did.** It described a "Built"
artifact — file trees, diffs, transcripts — that was never a `spec-poc/` directory; it was prose
inline in this section, and a later pass cut the prose while leaving the citation. `spec-poc/` on
this branch holds only its own README. **A conclusion cited to an artifact nobody can inspect is
worse than one with no citation, because the citation implies a check that cannot be performed**,
so the citation is withdrawn rather than repaired.

**Nothing rests on it.** The three findings that drawing exercise produced were migrated into the
themes that bind them, each with its own reasoning stated there and none citing the drawing:
theme 5 (one authored next-steps source, and why naming two servers matters), theme 6 (a run is
additive over what it touches), and theme 8 (mounted route where the location is derivable, second
process otherwise). Theme 9 postdates it entirely. Those four stand on their own arguments and were
re-derived to confirm it before this section was cut.

*If an end-state POC is built later, it belongs at `spec-poc/epic-building-with-fsd/` and this
section carries its path.*


## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| FIX-1159 | The brownfield knowledge — deterministic detection scripts, the install skill's **content**, the shared next-steps block, and **the wiring contract both entry paths satisfy** (theme 9) | spec | [#1310](https://github.com/fixpoint-labs/flow-state-dev/pull/1310) | — | In spec review — re-shaped to **brownfield only, no command of its own**; the earlier approval was retracted with the direction change. **Implementation now blocked by §5 Q6** — corrected this round: option (b) hands it a minimal-project host shape and a proof of its own, and it merges first, so landing it on an unchosen scope invalidates work downstream. Its *spec* may proceed, carrying (b) as an explicit conditional. (Q5 remains resolved by constraint: the run configures a non-default principal resolver, mechanism this issue's.) **Its decision 1 also needs to change**: theme 5 has the run *apply* the flow-registration line as an additive edit, where that decision hands it back, and handed back it leaves nothing we author reachable on the guest branch. Also gains the devtool peer fix (theme 5), the mounted-route proof (theme 9 (b)), and the **production-guard fixture** (theme 8) — the guest fixture cannot carry that check, and the assertion that said it could was unfalsifiable. **The fixture may run on the author branch after all** — the alarm that its mandated host-level resolver made the case impossible was measured and refuted (awkward, not impossible; two verified escapes). What the fixture asserts still follows from §5 Q7 |
| FIX-1162 | Register the npm names the launch needs — the short CLI entry name and the scaffolding name | spec | [#1313](https://github.com/fixpoint-labs/flow-state-dev/pull/1313) | — | In spec review — **both names now registered at `0.0.0` to a personal account**; what remains is the publishing identity's write access (`npm owner add` / transfer) and the unproven `@flow-state-dev` scope. Owner operations, not agent work |
| FIX-548 | `create-flow-state` — the deterministic greenfield path; template count pending **§5 Q6**, written against one (Next.js chat app), owned end to end | spec | [#1312](https://github.com/fixpoint-labs/flow-state-dev/pull/1312) | — | **Re-approval needed and NOT mechanical** — at `a3fc694` the spec takes five previously-unowned jobs into decision 3, **reverses decision 5** (verified: `providerPreference` is consulted only inside `resolveIntent`, so a declared `provider/model` never reaches it — the hijack scenario it guarded is unreachable on that path, not merely weakened), moves **Small → Medium**, and adds decision 8, a new **product statement** (*the generated app does not serve off-host until authentication is configured*). A scope change and a product statement are the owner's to read, not a sweep's to wave through. In Linear it is `blocks`-blocked by **FIX-1159, FIX-1160 and FIX-1162** — read from the graph, and over-tight against Sequencing, which calls the first two merge-order and forbids the third outright. Its spec is not edited by the epic. **Implementation is separately blocked by §5 Q6** — independent holds; clearing one does not clear the other |
| FIX-1160 | The authoring pack **and the plugin that distributes the install skill** — agent-instructions file, authoring skills, install skill | spec | [#1311](https://github.com/fixpoint-labs/flow-state-dev/pull/1311) | — | Spec complete, approved at `dd9b656` — **approval needs re-taking**: theme 9 (d) hands it the agent-instructions block's normalization and equality check (posted to #1311). Scope had already grown: it is the brownfield path's only delivery channel |
| FIX-1186 | The publishing identity's write access to the two names — `npm owner add` / transfer off the personal account | direct | — | — | **Backlog. Added to this index late — it has been a sub-issue of FIX-1161 in Linear while this table listed four issues**, which is the index failing at the one job it has. Owner-operated, not agent work. Blocks FIX-1187 (the first public publish, which is *not* a child of this epic). Its closing condition was moved to FIX-1187 to break a cycle; verified here — FIX-1187 has no outgoing `blocks` edges, so no path returns |

**Sequencing.** Three kinds, listed apart because a dependency column cannot tell them apart and
they mean different things:

- **Merge-order edges** (gate merge, nothing else): `FIX-1159 → FIX-1160 → FIX-548`. FIX-1160
  packages content FIX-1159 authors; FIX-548 conforms to FIX-1159's wiring contract and ships
  FIX-1160's agent-instructions block. Each pair can still be specced in parallel.

  **Flagged, not reconciled — the Linear graph does not match this section, and one edge contradicts
  it outright.** Read from Linear rather than assumed, FIX-548 is `blocks`-blocked by **FIX-1159,
  FIX-1160 *and* FIX-1162**. Under `epic-lifecycle` a `blocks` edge means the issue cannot enter the
  active set at all — not that it merges later. So the first two are over-tight against this
  bullet's "can still be specced in parallel", which is not hypothetical, since all four specs were
  in fact written in parallel. **The third is worse than over-tight: it is the thing the release-gate
  bullet below explicitly forbids** — FIX-1162 is wired as an activation gate on FIX-548 while this
  document says in bold that it must not be treated as a merge edge, which would stall the epic's
  largest issue behind an owner-operated npm transfer. Left for the coordinator because the epic does
  not edit the graph. **All three are the same confusion that produced the FIX-1162 release cycle** —
  a condition wired as an activation gate — so the fix is one convention, not three edge edits.
- **Release gates** (gate shipping only — no issue's spec, build, or merge): the publishing identity
  can write every package the quickstarts install (theme 1). **FIX-1162 is not a merge edge on
  FIX-548 and must not be treated as one.**
- **Undecided, not deferred**: the second template — **§5 Q6 is open.** Not an accepted deferral, and
  **neither FIX-548 nor FIX-1159 may be advanced to implementation on a one-template scope until it is
  answered.** FIX-1159 was added to this bullet on review: option (b) changes its scope too, and it is
  first in the merge order.
- **Undecided, not deferred**: what an unauthenticated generated demo does on a network — **§5 Q7 is
  open.** No issue implements a production or bind refusal until it is answered; theme 8 states the
  measured behaviour and mandates nothing.

## 5. Open cross-cutting questions

**Q6 is open and blocks FIX-548's *implementation*** — the one-template cut was recorded here as
the owner's without evidence, and FIX-548 has been carrying it as its open ask all along. **Its
re-approval is not blocked *by Q6***, because that spec no longer asserts an answer; what Q6 stops
is building against a template count nobody chose. **That is not the same as the re-approval being
ready**, and it is further from it than "defects" suggests: at `a3fc694` that spec has taken on five
previously-unowned jobs, **reversed a decision**, moved **Small → Medium**, and added a **new product
statement**. A size change and a product statement are the owner's to read. Q6 and that hold are
independent; clearing one does not clear the other.

**Three questions are open: Q6 and Q7, which block, and Q4, which does not.** Q1–Q3 and Q5 are
**decided** and stay here with their answers, so no issue reopens them.

| | Status | What it gates |
|---|---|---|
| **Q6** — one starter or two | **open** | **Blocks the implementation of FIX-548 *and* FIX-1159** — the second added on review: option (b) gives FIX-1159 a new host shape and its own proof, and it merges first, so a reopen invalidates work downstream of it.** It does **not** block that spec's re-approval — though that re-approval is separately held, and not for mechanical reasons: a scope increase (Small → Medium), a reversed decision, and a new product statement. A different hold, and a heavier one. |
| **Q7** — what the unauthenticated-demo rail should do | **open (2 of 4 forks settled)** | **Blocks any unauthenticated-demo refusal work in every issue.** Forks (2) and (3) decided by the coordinator; (1)+(4) go to the owner as one question. Raised by a POC that ran the real code: the rail is whole-app not per-flow, keys on bind address not environment, and is never invoked on either path this epic ships. The epic's product statement is **withdrawn** until this is answered. |
| **Q4** — does install-by-URL still hold | **open** | Nothing. It exists because the split changed what an already-made decision costs. |
| Q1, Q2, Q3, Q5 | decided | — |

*This summary previously read "Q4 is the only one open", one paragraph below the text establishing
that Q6 is open and blocking. A reader who took the summary at its word could have advanced FIX-548
on a scope nobody approved — the same defect as §1's, in a second location, and the reason the
sweep that follows covers **status** claims and not only answer claims.* **Q5 was raised as a
product fork and resolved as an engineering one**, because both of the cheaper options turned out
to be unavailable rather than merely unattractive; it is kept in full so neither is proposed
again.

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

**Resolution — `AGENTS.md`.** *Decided by the coordinator from the objective, not by the owner —
unlike Q2 and Q3 no owner record exists, and an attribution sweep confirmed none is claimed here.*
Decided by the objective's first line: the outcome is that the
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

**Resolution — install-by-URL only at launch. No public directory listing during the launch
window.** **The decision is the product owner's** — recorded contemporaneously on the epic PR
(#1301, comment 5298965007, 2026-08-14T22:56:22Z, "Two owner decisions recorded"), which is the
evidence an attribution sweep checks it against. *The rationale that used to appear here —
"a support commitment in the week we can least afford one", with the add-later/delist-later
asymmetry settling it — is the **coordinator's reconstruction**, not words the owner is recorded
as saying. It is verbatim the recommendation two paragraphs above, and presenting it as reasoning
that "goes past the recommendation" dressed our own argument in their authority.* The decision
stands exactly as given; only the account of why is marked as ours.

**FIX-1160 is scoped accordingly — the plugin still ships; only its distribution channel is
narrowed.** Because the channel is singular, **§1's proof runs through it**. Carried by theme 3.
**Closed — not reopenable by an issue**, but see **Q4**: the split has changed what this decision
costs, which only the owner can weigh.

*Mechanism note, from FIX-1160's POC: Claude Code has **no bare-URL plugin install** — the path is
`plugin marketplace add <source>` then `plugin install`, so a marketplace manifest is a **required
distribution artifact** rather than a public listing. Consistent with this resolution as written; it
sharpens Q4 rather than reopening this.*

### ~~Q3 — FSD ships a runtime concept called `skills`, and FIX-1160 ships Claude `skills`. Rename ours, rename theirs, or ship the collision?~~ — decided: no rename, qualify instead

*Raised by the epic-spec: the two words would sit on adjacent public docs pages, and FIX-417 /
FIX-424 own the existing one. It touches naming across the set, so it is not FIX-1160's alone.*

**Resolution — no rename, and the premise that the two are unrelated is rejected.** Both are the
same *kind* of thing — a packaged capability an agent loads — at different layers, so the shared
word is coherent rather than colliding, and this is not the incoherence case it was raised as.
The resolution is **qualification, not renaming**: write *Claude skills* or *the Claude plugin*
wherever ambiguity is genuinely possible, and let FSD's runtime concept keep the bare name
`skills`. **FIX-417 and FIX-424 are unaffected and must not be touched.** *Owner decision,
recorded on the epic PR alongside Q2 (#1301, comment 5298965007, 2026-08-14T22:56:22Z).* The split makes this
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

**The trade-off.** Holding URL-only keeps the launch's public surface as small as Q2 set it, and
the docs are where the launch sends people anyway — the install source sits on the getting-started
page and in the README. Listing puts the brownfield path where people browse, and takes on a
standing support commitment during launch week.

**My recommendation: hold URL-only, and make the docs carry it properly.** The add-later /
delist-later asymmetry still holds after the change — a listing is trivially added afterwards,
while delisting reads as abandonment — and the launch's own traffic goes through the docs, so the
channel is not as narrow in practice as "URL-only" sounds. **Stated as my argument rather than
yours:** that asymmetry is the coordinator's reasoning, recorded under Q2 as a reconstruction, not
something you are on record as saying — so it is offered here for you to weigh, not returned to
you as your own settled view. What I would add is a requirement rather than a listing: the install
source is on the getting-started page and in the root README, not only in FIX-1160's own docs, so
a stranger meets it on the first page they read.

**What would change my mind:** if the launch plan expects developers to arrive with an existing
repo *first* and read docs second — an announcement aimed at "add this to your app" rather than
"try this out" — then brownfield is the headline and burying its only channel one click deep is
the wrong call.

**Cost of being wrong.** Wrong on holding: the epic's most valuable capability is reachable only
by people who read far enough, during the weeks that matter most — recoverable, but the recovery
is a listing you did not want to own yet. Wrong on listing: a public entry to keep green in the
noisiest period we will have, which is the cost you already declined once.

### ~~Q5 — A brownfield run adds an open endpoint to a server the developer already exposes. Do we ask them to log in on day one?~~ — resolved by constraint: **close it, with a credential**

*Raised by review against `docs/architecture/authentication.md` and verified in `next@16.3.1`. It
was put here as a product fork — accept the exposure or pay for authentication — and it is no
longer one, because **both cheaper options were eliminated on engineering grounds rather than on
taste.** Recorded in full so nothing re-proposes them.*

**The exposure.** When the agent adds FSD to a Next.js app someone already has, it writes a demo
endpoint into *their* server, which they start the way they always do. Next's dev server listens on
every interface by default (`next@16.3.1`: `-H, --hostname` … *default: 0.0.0.0*). Everything this
epic generates runs on `defaultBodyUserIdPrincipalResolver`, which
`authentication.md:122-132` protects **only** via the loopback rail in `@flow-state-dev/node` — an
adapter the mounted path never uses.

**This is not the same class of risk as the development-only file store, and the comparison was
withdrawn.** The file store risks the developer's own data, on their own disk, under their own
control. This spends **their provider credentials** at the request of anyone who can reach their
laptop, and because the default resolver trusts a caller-supplied `body.userId` there is no tenant
boundary either — a caller picks whose session they act as. Same machine, different order of
seriousness.

**Eliminated 1 — ship it open with a warning in the diff.** This was the recommendation here for one
round and it was wrong. Two independent reviews and our own architecture doc agree that the rail is
the protection for default-resolver apps, not an advisory. A disclosure informs; it does not stop a
request. There is no reading under which a note in a diff is "another actual network rail".

**Eliminated 2 — a loopback guard inside `createNextHandler`, which is code we own.** The better
idea, and the one worth recording because it *should* work: when the default resolver is in play,
refuse any request whose peer is not loopback, and return a 403 naming what to configure. It would
close every adapter at once, need no change to the developer's `dev` script, and violate nothing in
theme 6. **It dies on the signal, not the design.** A Next App Router route handler receives a web
`Request`; `NextRequest` in `next@16.3.1` exposes no peer address (`ip` was removed, and
`connection()` returns `Promise<void>` — a prerendering signal, not a socket). The only inputs left
are headers, and a guard keyed on `x-forwarded-for` or `host` is defeated by sending a header, which
is worse than none because it looks like protection.

**Resolution — the brownfield run configures a non-default principal resolver on what it
generates.** That is exactly the condition the framework guard keys on, so it is a rail rather than
a notice, and it does not depend on a peer address we cannot obtain. **The mechanism, stated as a
mechanism and never as a value:** the run generates a random secret at install time, writes it to
the `.env.local` it already touches (never to a tracked file — theme 6 refuses that outright), and
the generated config reads it **by environment-variable name** in both the principal resolver —
declared **per-flow** on the demo flow, which is what the bind guard actually inspects (theme 8) —
and the `devtool` block. **Where each lands depends on who wrote the config** (theme 5): when the
run writes it, both go in, plus a host-level resolver; when the config is the developer's, only the
per-flow resolver is written — into our own flow file — and the **host-level** resolver is withheld,
because a host-level resolver in *their* config would be inherited by *their* flows and 401 their
working app. The registration line and an absent `devtool` block are **applied** as additive edits;
withholding them left nothing we author reachable at all (theme 5). No literal secret appears in this document, in the template, in a printed
command, or in any committed file. **The mechanism is FIX-1159's** within that constraint;
the greenfield **template** does **not** also take a credential — because its demo is a browser page, so a token it could
present is one an attacker can read from the same page; loopback is its whole control, and theme 8
states the comparison exactly.

**What this closed and what it did not.** Closed: an unauthenticated caller is refused, so a
stranger on the same network cannot spend the developer's provider key or act as another user.
Not closed: the port still listens on every interface, because it is their dev server and theme 6
forbids us editing it. The endpoint remains reachable and probeable; the secret is what stands
between a caller and the flow, rather than the absence of a route. **The question this section
asked is answered — yes, we require a credential — and the guarantee is *different* from
greenfield's rather than a lesser version of it.** Greenfield has **one** control, the loopback
bind, and no credential: its demo is a browser page, so any token it could present is one an
attacker reads from the same page. **Brownfield has one or two depending on topology** — the
mounted-route branch has the credential only, since the developer's dev command starts the server;
the **second-process** branch has both, because we author the printed `fsdev serve --host
127.0.0.1` *and* ship no browser client. **Theme 8's matrix is the statement of record; this entry
has now been wrong in both directions** — first claiming greenfield had "both layers", then
answering that with a flat "one control each" that erased the second-process branch's two. Either
error lets a reader drop a control as redundant. What each configuration leaves open is stated in
theme 8. That is disclosed in theme 8 rather than treated as an open
fork, because the only option that would close it is refusing to mount a route in a brownfield Next
app at all, which trades the epic's headline integration for defence in depth over a control that
already works.

**It also broke the next line of its own next-steps block, which is recorded here because the
lesson generalizes.** Securing the `FlowState` meant `fsdev dev` opened a DevTool whose API calls
failed authentication — the command the developer is told to run immediately after — and, less
visibly, it satisfied `assertNetworkBindIsAuthenticated` and so **removed** a rail that had been
refusing `fsdev serve` a network bind. Theme 5 now keeps the printed block under a **standing**
goal check keyed on shipper × host rather than a trigger someone has to notice.

**What this costs, so the owner sees it rather than discovers it.** The brownfield first run is
unchanged for the printed CLI command, which runs in-process and never crosses HTTP. It changes for
anyone who calls the mounted route directly — a `curl`, or their own UI — who now needs the value
from `.env.local`. That is a real if small tax on the first hour, and it is the price of the
endpoint not being open. **Not a gate**: no issue waits on *this question*, and it is not what
holds FIX-1159. *Stated narrowly on purpose — "FIX-1159 is unblocked" was too broad a claim for a
single question to make, and Q6 may yet add a deliverable to that issue.*

**If this turns out wrong**, it is wrong in the direction of friction rather than exposure: a
developer hits a 401 on their own machine and has to look in `.env.local`. The alternative was
wrong in the direction of a stranger spending their credits, which is the failure this epic's whole
brownfield pitch — *we will not damage your repo* — cannot survive.

### Q7 — The rail that is supposed to keep an unauthenticated demo off the network does not reach either path we ship. What should it do? — **open; blocks any production-refusal work**

*Raised by a POC that ran the real code instead of reasoning about it, after three product
statements in a row were written from the rules and each turned out false. Theme 8 carries the four
findings and the fixture; this entry carries only the decisions, because they are yours.*

**Plain terms.** A generated demo app talks to a real model on the developer's provider key. If it
is reachable from a network without authentication, anyone who can reach it spends their money and
can act as any user. We believed the framework refused to serve in that state. **It does not, on
either path this epic ships** — the check exists, but it only runs when someone starts the server
with our own CLI command, and both of our paths start it another way.

**Nothing is being asked about whether to close this. It is three questions about what closing it
should feel like to a developer**, and they are yours because each one trades their convenience
against their exposure.

**(1) When a demo flow is unauthenticated, does the app refuse to start *that flow*, or refuse to
start at all?**

- *Refuse the whole app* is what ships today. Cost: near zero, it already works. What a developer
  experiences: their properly-secured flows stop serving too, because of one demo flow they may not
  have written — a hard startup failure naming a flow that is not the one that broke.
- *Refuse only the offending flow* is what this document has been assuming and what nobody built.
  Cost: a real change in `@flow-state-dev/engine` — per-route refusal rather than a bind-time abort
  — call it days, not hours, and it touches a security path. What a developer experiences: the app
  starts, their flows serve, the demo endpoint returns a clear error naming what to configure.
- **My recommendation: refuse only the offending flow**, because the brownfield promise is that we
  are additive over someone else's working app, and a whole-app refusal breaks that in the most
  severe way available. **What would change my mind:** if you would rather a misconfigured app fail
  loudly and completely than serve partially — a defensible position for a security control, and the
  cheaper one.

**(2) ~~Does the refusal key on the bind address, or on the deployment?~~ — DECIDED by the
coordinator: keep the bind address, and stop describing it as production.**

*Settled rather than escalated, and the reason is that there is no product content in it: it is a
description being made to match a mechanism, and the alternative is inventing a deployment signal we
do not have. Recorded as the coordinator's, not the owner's, and not as a recommendation they
declined to answer. Every product statement this epic got wrong said "production" about a predicate
that reads a bind address — the defect was in the description each time, never in the predicate.*
**Consequence carried forward:** no document, template, comment or error text in this epic describes
this control in terms of production or deployment. **Bounded by fork (4)**, which is where the
mounted and serverless paths — having no bind to read — get their own signal.

*The original fork, kept so nothing re-proposes it:*

- *Bind address* is what ships: `--host 127.0.0.1` is exempt, `0.0.0.0` is refused, and the
  environment is never consulted. Cost: zero. What a developer experiences: a container that binds
  `0.0.0.0` is refused even in a private network, while a production box bound to loopback behind a
  proxy sails through unauthenticated.
- *Deployment* is what every product statement we have written implied. Cost: we would have to
  decide what "production" means for a framework that runs on Vercel, Next, Node and a queue —
  `NODE_ENV` is the obvious answer and it is wrong often enough to matter. What a developer
  experiences: it works on their laptop and refuses when deployed, which is the mental model the
  scaffold's docs would teach.
- **My recommendation: keep the bind address and stop describing it as production.** It is the
  signal we can actually observe, and the failure we kept having was in the *description*, not in
  the predicate. **What would change my mind:** if the scaffold's story is "deploy it and see" — then
  a developer meets this control at deploy time and it has to speak that language.

**(3) ~~Do we let the guard see a host-level resolver?~~ — DECIDED by the coordinator: do the named
minimum fix. Filed as FIX-1189; non-blocking.**

*Settled on the author's own framing: nothing about the developer experience would have changed the
recommendation, only sequencing, which makes it an engineering call rather than a product one. The
fix is described on FIX-1189 — pass the app's configured `resolvePrincipal` into
`assertNetworkBindIsAuthenticated` and count a flow unauthenticated only when its **effective**
resolver, per `pickPrincipalResolver`'s precedence, is undefined or default-branded.* **Sequencing
is handled when FIX-1189 is picked up and gates nothing here. The one standing constraint until it
lands: no artifact this epic ships may print or document `--allow-unauthenticated` as the remedy for
a correctly-authenticated app** — that flag disables the guard wholesale, and teaching it is how a
later unauthenticated flow ends up binding silently.

*The original fork, kept so the reasoning is not lost:*

*This option did not exist when the fork was first written; it comes out of the measurement.*

- *Leave it* is today's behaviour: an app authenticating at the host level is refused on a network
  bind, and its only sanctioned escape is **`--allow-unauthenticated`** — a flag that disables the
  guard **wholesale** on a fully authenticated app. Cost: zero. What a developer experiences: they
  configure authentication correctly, are refused anyway, are told by our own error text to pass a
  flag that turns the protection off, and a flow they add six months later binds unauthenticated
  and silently. **This is the sharpest hazard the measurement found, and it is created by the
  remedy rather than by the gap.**
- *Fix it* means passing the app's configured `resolvePrincipal` into
  `assertNetworkBindIsAuthenticated` and counting a flow unauthenticated only when its **effective**
  resolver — per `pickPrincipalResolver`'s existing precedence — is undefined or default-branded.
  Cost: small and contained; it makes the guard agree with the resolution order the rest of the
  framework already uses. What a developer experiences: configuring authentication once, at the
  level they chose, is enough — and nobody is taught the flag.
- **My recommendation: fix it**, independently of how (1) and (2) land. It is the only option here
  that removes a reason to reach for `--allow-unauthenticated`, and every hour that flag is the
  documented answer is an hour we are teaching people to disable a security control. **What would
  change my mind:** nothing about the developer experience — only sequencing, if the framework fix
  cannot land inside this epic's window, in which case the scaffold must not print the flag.

**(4) Where can this be enforced at all — because the path that is exposed is the one path that
can see nothing?**

*This fork replaced one asking whether to guard `serve()`. **That question was aimed at the wrong
path**, and the correction is the most important thing in this entry. Plain-Node brownfield already
enters through the guarded `fsdev serve` CLI. Greenfield Next — our headline entry path — mounts
through `createNextHandler` and touches neither `serve()` nor the CLI, and so does brownfield Next.
So guarding `serve()` would have protected the path that is already protected and left both exposed
paths exposed. The remedy had inherited the boundary of the artifact that motivated it: the
measurement ran through `fsdev serve` because that is where the guard lives, and the fix followed
the measurement's frame instead of the exposure.*

**The honest headline, and the owner should see it in this form: the only place we enforce this
today is the CLI, and two of our three topologies do not use the CLI for the route that matters.**
Greenfield mounted-route and brownfield mounted-route both run inside the developer's own Next
server. Only brownfield second-process goes through `fsdev serve`.

**And the mounted route cannot be given the same kind of guard**, which is measured rather than
assumed and is recorded under Q5's *Eliminated 2*: a Next App Router handler receives a web
`Request`, and `NextRequest` in `next@16.3.1` exposes **no peer address** — `ip` is gone,
`connection()` is a prerendering signal. A guard keyed on `x-forwarded-for` or `host` is defeated by
sending a header, which is worse than none because it reads as protection. **So no network-position
control is available on the exposed path, at any price.** That constraint, not cost, is what shapes
the options:

- **(A) `createNextHandler` refuses a default-resolver flow unless the app explicitly opts in.** No
  peer address needed — the handler judges the flow's *effective* resolver, which it can see. Cost:
  contained, it is our code and one check at handler construction; the greenfield template must then
  either ship a real resolver or carry the opt-in, which is a template change rather than a
  framework one. What a developer experiences: a scaffolded app refuses its demo route until either
  we configured something or they did, on every host including serverless, with no environment
  guessing.
- **(B) The same check, but only when the environment says production.** Cost: A's cost plus owning
  the definition of "production" across Next, Vercel, Node and a queue, where `NODE_ENV` is wrong
  often enough to matter. What a developer experiences: development is untouched and deployment
  refuses — the mental model every product statement we wrote already implied, which is an argument
  for it and also the reason it keeps getting assumed.
- **(C) Accept that the mounted route is unguarded, and say so plainly** in the scaffold's docs and
  its generated comments. Cost: zero to build. What a developer experiences: the default deployment
  of the app we generated is an open model endpoint on their key, and the only thing standing
  between them and that is having read a paragraph.
- **Note on `serve()`**, kept because it is real and demoted because it is not this: guarding it
  would close hand-written Node embedders, who are nobody this epic ships to. Worth doing on its own
  merits, not as an answer to this fork.

**My recommendation: (A).** It is the only option that reaches the exposed path, it needs no signal
we have already proved unavailable, and it fails in the direction a demo scaffold should fail. **What
would change my mind:** if refusing in development would break the first-run experience the epic
exists to create — which is exactly what (B) is for, and I would rather take (B) than (C).
**Note this fork constrains fork (2):** "key on the bind address" cannot be the whole answer, because
the mounted route has no bind to key on. Bind address is right where a bind exists; the mounted and
serverless paths need one of (A)'s or (B)'s signals regardless.

**Cost of being wrong, across all four.** Wrong toward permissive: a scaffold whose default
deployment is an open model endpoint billed to the developer, which is the thing Q5 already refused
to ship for brownfield. Wrong toward strict: developers hit refusals in setups that were never
exposed — a private network, a proxied host — and route around the control, which ends with them
disabling it everywhere. **The asymmetry favours strict**, because a refusal is visible and a
silent exposure is not.

**What is waiting on this.** No issue implements a production refusal until it is answered. Theme 8
states the measured behaviour and makes no promise; the epic's product statement is withdrawn until
Q7 answers it, and it will be written once from that answer rather than derived again.

---

### Q6 — Does v1 ship one template or two? — **open; blocks the implementation of FIX-548 *and* FIX-1159, neither's re-approval**

*Not a new question: it was raised from FIX-548's spec, recorded here as "raised, not adopted",
re-argued, and then written into theme 2 as an owner decision that was never given. Restored to
open. *An earlier revision of this entry called FIX-548's spec "the accurate record" on this
question — **withdraw that**: a cross-spec sweep found its ask still arguing for a recommendation
since withdrawn, and five jobs disclaimed by both it and FIX-1159. It is right that the question is
open and wrong about the rest; a FIX-548 worker is correcting it in parallel and this document
should not be cited as vouching for it.* It has carried this as its §6 decision 2 ask
throughout, and the epic is what drifted.*

**Plain terms.** We ship a starter that creates a new project. The question is whether v1 ships
one — a Next.js app that ends at a chat page you can type into — or also a second for backend
developers, which ends at a server with no screen.

**The trade-off — corrected, because the version of it that reached the owner was wrong.** This
entry claimed the Node starter's contents were already obtainable via `mkdir && <brownfield run>`.
**That substitute does not exist** — but **the gate it fails on is not the one this entry used to
name, and the re-derivation changes what option (b) costs.** Brownfield is defined throughout as
modifying a project that already exists, it is proved only against an *existing* plain-Node app,
and the empty-directory worked example was deleted from FIX-1159 along with the greenfield goal
check that ran it. §1 says the same from the other side: the two-command alternative *"no longer
exists, because there is no brownfield command to run second"*.

**The gate that actually holds, verified against FIX-1159 at head (`6b2c4093d`), is the package
manager — not the dev command.** *This entry previously cited detection's `dev command` row
refusing when no script starts anything. **That row was narrowed and no longer says it:** it now
reads "Reported for every host; required only where the next-steps block spends it — the
`mounted-route` topology. No usable script on a Next host → refuse. On a plain-Node host → report
`none` and proceed."* What refuses a bare directory instead is the **package-manager** row:
*"Neither a field nor any lockfile in the whole chain → `undeclared`, which also refuses"*, backed
by a deliberate design rule — *"there is no ambient signal worth trusting: `npm_config_user_agent`
describes how our own script was launched, not what the project uses, and defaulting to npm writes
a lockfile the project never asked for."* An empty directory has neither; `npm init -y` alone
produces a manifest with no `packageManager` field and no lockfile, so it refuses too.

**So the real cost of cutting is not a worse path for backend developers. It is no path.** A
backend developer starting fresh would have to hand-build a Node project *with a working dev
script* before the skill would engage — which is the manual assembly this epic exists to remove —
or take the Next.js template and strip it, dragging `next` and `react` into a backend service.
**Against that**, every template is proved per advertised provider on every release, on machines we
do not control, forever.

**My recommendation has changed, and it is now conditional.** It was "ship one", resting on the
substitute. Without it, "ship one" means **§1's own outcome — a working feature in their project,
"new or existing" — is unmet for backend developers in v1**, which the asymmetry argument does not
answer: adding a starter later is indeed additive, but deferring now defers an audience to nothing
rather than to something lesser. There are three options, not two.

**Before reading them — "ship one" is no longer an answer to this question.** The earlier ask
recommended "ship one", and under this framing that phrase means **(c)**, the option I no longer
recommend. It is a live trap rather than a tidy-up, because **two** of the three options ship one
starter: (b) ships one *and* specifies a minimal-project brownfield path, (c) ships one and serves
nobody else. An answer given from memory of the old framing selects (c) while sounding like it
could mean (b). **Please answer by letter.**

- **(a) Ship two starters.** Serves backend greenfield deterministically. Costs a second starter
  kept green and proved per provider, forever — the original objection, unchanged.
- **(b) Ship one starter, and specify and prove a minimal-project brownfield path** — the smallest
  project the skill will engage with. **This costs less than this entry used to say, and the
  correction is in your favour.** The dev-command relaxation it was priced on is **already in
  FIX-1159 at head**: a plain-Node host with no usable script reports `none` and proceeds, because
  the `second-process` branch prints only `fsdev` commands and never names the host's script. What
  remains is the **package-manager** gate — and that may need no relaxation either, only a stated
  precondition, since a project with a `packageManager` field *or* any lockfile already resolves.
  On the two gates I checked, `npm init -y && npm install` would proceed; **I have not walked every
  refusal**, so (b)'s honest cost is *verify the minimal precondition end to end, document it, and
  prove it once* — not "relax a refusal". If some other gate does refuse, (b) grows back toward
  what this entry originally claimed.
- **(c) Ship one starter and accept that backend greenfield is unserved in v1** — *this is what the
  old "ship one" ask meant.* Honest, and the cheapest — but it should be chosen knowingly rather
  than inherited from a substitute that was never real.

**Recommendation: (b) if FIX-1159 will carry it, otherwise (a).** (b) serves the audience without a
second artifact to keep green. *The argument for it used to be that the skill owes this anyway,
since a project with no dev script was refused rather than served as the second process theme 8
says that host gets — **that has since been fixed in FIX-1159 independently**, which removes the
argument while making (b) cheaper. The recommendation stands on the audience, not on the debt.* **I no longer recommend (c)**, which is what "ship
one" silently meant.

**What would change my mind:** if the launch plan points backend developers at a Node starter *by
name* — a landing page, a comparison table, an announcement. A template that exists to be linked
to is worth more than the files it writes, and that is a business fact no spec here has.

**Cost of being wrong.** Ship one *without* (b) and be wrong: backend developers have no
first-party way to start a new FSD project at all during launch — recoverable by a later release,
but it is an audience meeting a closed door rather than a plain one. Ship two and be wrong: a
starter kept permanently green and proved on every release, for an audience that would have been
served by (b) at a fraction of the standing cost. *(An earlier draft of this line said "for a path
the brownfield run already proves" — that is the struck substitute, and it does not prove it.)*
**And one live consequence if Q6 lands on one** — §1's brownfield second-process check becomes the
epic's *only* Node coverage of any kind, so it can no longer be dropped as redundant.

**What is waiting on this, stated precisely because an earlier draft of this line said the wrong
thing.** **Not** FIX-548's re-approval — Q6 does not block it, since its spec *asks* the question
rather than answering it. *Separately, and not because of Q6, that re-approval is **not** ready, and
not mechanically so: at `a3fc694` FIX-548 has absorbed five previously-unowned jobs, reversed a
decision, moved Small → Medium, and added a new product statement. An earlier version of this line
said "safe to take now" and the running index went on saying it for three further rounds; that
inference no longer holds, and it is the kind of claim this document should stop making about a spec
it does not own.*
What waits is **FIX-548's implementation**: this is the one open item that changes what it builds.
If the answer is **"one"**, §6 decision 2 becomes stale rather than open and building proceeds. If
**"two"**, decision 2 reverses *and* decision 2b (no `--template` flag) reopens with it — that is a
spec revision, so FIX-548 needs another pass rather than only different code. **FIX-1159 is *gated*, not merely affected — corrected, and the correction changes what you are
deciding.** Option (b) hands it a new supported host shape (the smallest project the skill will
engage with), the precondition work to make that shape resolve, and **a proof of its own**. Treating
that as an "affected" note would let FIX-1159 land on a scope nobody chose — and it is **first in the
`FIX-1159 → FIX-1160 → FIX-548` merge order**, so a reopen after the fact invalidates content
FIX-1160 has already packaged and a contract FIX-548 has already conformed to. **The gate is on its
implementation, not its spec**, matching FIX-548: its spec may proceed, but must carry (b) as an
explicit conditional rather than quietly assuming (c). *Weighed the other way honestly — a gate is
heavier than a reopen only when the addition is small and terminal, and this one is neither: it is
upstream of both other issues.* **So Q6 now gates two issues, and that is part of what it costs to
leave it open.**

---

## Epic evolution

One line per turn: trigger, change, reason. **Reasoning that still binds lives in the themes and
decisions above and is not repeated here** — a rule this section broke badly enough to be rebuilt,
after review found it had grown into multi-paragraph defect narratives that could disagree with the
themes they summarized. *Cause, recorded because it was not carelessness: the coordinator
repeatedly asked for diagnoses to be recorded "in the evolution log", and an instruction to record
something is not an instruction about where it belongs.* The transferable lessons extracted from
those narratives now live in
[`docs/internal/lessons-2026-08-18-epic-fix-1161.md`](../../docs/internal/lessons-2026-08-18-epic-fix-1161.md).

- **Epic drafted** — three issues under one outcome; scaffolder a thin wrapper over `fsdev init`, two templates accepted.
- **After the end-state sketch** — added theme 5's one-next-steps-block clause and theme 6 (a run is additive), because drawing the diffs showed what prose had not.
- **Q1 answered** — `AGENTS.md`; theme 6 took the append-never-overwrite guarantee.
- **After epic review** — added theme 8 (mounted route where derivable, second process otherwise), because §3 had surfaced the asymmetry in a section that binds nothing.
- **Q2, Q3 answered** — install-by-URL only; no rename for `skills`. Both carried by theme 3.
- **Epic review, rounds 2–3** — theme 6's boundary named the lockfile; FIX-1162 added to the index; §1's FIX-1160 proof routed through the plugin.
- **Two convergence passes** — FIX-548's demo-content scope, the existing-Node proof, the required store profile, seeded sentinels.
- **Owner direction change** — brownfield becomes an agent skill, greenfield stays a command; deterministic mutation goes. Themes 1, 5, 6, 8 re-drafted; new Q4.
- **Owner decision folded — the scaffolder name** (`create-flow-state`, verified against the registry). §1's Outcome stopped promising "one step".
- **Epic review of that fold** — §1's greenfield proof gained the additive assertion it had extended without checking; theme 5's "verbatim" became one authored source rendered per package manager.
- **New theme 9** — shared content needs a named author and an ordering edge; generalized to three artifacts with author/kind/carrier/check.
- **Four fixes to theme 9** — self-referential digest, the FIX-1160→FIX-1159 ownership cycle, the Node 20.9–21 scaffold, theme 6's `package.json` formatting promise.
- **The digest deleted rather than fixed a fifth time** — every defect was in a *stored value*, so the marker and the hashing both go; check is normalized text equality. Same batch: host-topology conditionals, and a pnpm-isolated install for the greenfield manifest.
- **Theme 9 halved (231→117 lines)** — mechanics devolved to the issues that own them; the author exports the comparison, each shipper invokes it. FIX-1160 and FIX-548 need re-approval.
- **npm gate reframed** — both names registered but to a personal account, so the gate is the publishing identity, not the name. `fsdev run` takes caller identity as its own parameter, so two printed commands dropped a `userId` that set nothing.
- **Loopback exposure found on the mounted path** — the rail lives in one host adapter, so the rule is stated per adapter. Greenfield binds loopback; brownfield generates a credential (Q5). Runtime floor restored to 22.18 after a compression dropped it; §1's proofs cut to user-level.
- **Q5 resolved by constraint** — an in-handler guard is impossible (no peer address in a Next route handler) and a warning is not a control. Static provider wiring and the devtool React peer folded the same turn.
- **Credential wiring audited** — the DevTool needs the same secret; `git check-ignore` became a precondition before any credential is written; every control gained a negative case.
- **Attribution audit** — the one-template cut was recorded as the owner's without evidence and is reopened as **Q6**; Q2's rationale re-marked as the coordinator's; Q4 stopped pre-arguing from words the owner never said.
- **Length and sibling sweep** — §3 cut to four lines, §4 to its table, this log rebuilt; the reopened Q6's stale deferral entry corrected, and the bind guard's predicate stated once after a paraphrase got it wrong.
- **Q6's substitute struck, and the recommendation re-derived** — `mkdir && <brownfield run>` does not exist: brownfield modifies an existing project, and FIX-1159 refuses the empty case at its `dev command` gate. Cutting the Node starter costs backend developers **no path**, not a worse one, so the recommendation changed from "ship one" to **(b) ship one *and* specify a minimal-project brownfield path, else (a) ship two**. Same turn: exception (c) widened to `start` after the sibling script went unchecked, theme 8's rule completed adapter-independently (the config refuses to serve a default-resolver flow outside development), and §3's citation to a non-existent POC withdrawn.
- **§1 stopped answering Q6, and the production guard got a negative case** — gated §1 named "v1 ships one, the Node template is cut" as a *non-goal*, so approving the epic would have ratified Q6's least-recommended option without the reader knowing they were deciding it. Removed and swept by premise: theme 2's heading, its superseded asymmetry argument, and two residuals inside Q6 itself (including the struck substitute resurfacing in its cost line). **The adapter-independent production refusal — added one round earlier to close a security exposure — had nothing able to detect its absence**, the seventh instance of that defect; §1's greenfield proof and theme 5's negative list now require it to fire before any model invocation. And the brownfield credential must be declared at **both** resolver levels: the bind guard reads per-flow only, while host-scoped session listing reads host-level only and withholds rows for per-flow-authenticated flows — jointly satisfiable, and silently broken in opposite directions if only one is set.
- **"One control each" was the mirror of the error it fixed.** An early round claimed greenfield had "both layers"; the correction flattened a **per-topology** fact into a **per-path** rule and erased that the plain-Node `second-process` branch has *both* the loopback bind and the credential. **The failure it enabled is a check that cannot fail**: that branch installs a per-flow resolver, so every flow authenticates, `assertNetworkBindIsAuthenticated` returns early on `unauthenticated.length === 0` and **permits** a non-loopback bind — an implementer dropping `--host 127.0.0.1` draws no complaint, and §1's proof asserted only credential acceptance and refusal. Severity stated honestly: a specified layer lost, not an endpoint opened. Replaced with a per-(path × topology) matrix and the generalisation that actually holds — **the bind follows *who authors the start command*, the credential follows *whether the demo ships a browser client*, and neither question runs along greenfield/brownfield.** §1's second-process proof now asserts the bind. Two further rules are flagged as stated per path with a different cause (theme 6's exception (c), the credential rule), left conditional on Q6 rather than rewritten for an undecided answer. **Third time a fix for over-claiming produced under-claiming or the reverse.**
- **The two-level resolver fix broke the additive promise in someone else's repo, and the fix was mine.** A host-level resolver is inherited by every flow with no override (`pickPrincipalResolver`), and FIX-1159 *proceeds* when the project has its own config — so instructing that developer to add one would 401 their working flows, silently. No host-level resolver can avoid it: the guard branches on resolver **identity** (`isDefaultBodyUserIdPrincipalResolver` is a brand check) and the default's behaviour is *not to run the guard at all*, so any real function flips every override-less flow out of the no-enforcement branch — checked before choosing, because a third remedy would have beaten both offered ones. **Resolution is keyed on authorship**, the boundary theme 6 already uses: when the run writes the config, install at both levels; when the config is theirs, per-flow only in our own flow file, and the two config lines are *handed over* rather than applied. Cost, disclosed: the DevTool's session list will not show our flow in the guest case. Theme 6 also gained the general form — **the guarantee is about behaviour, not only files**, since every file rule can hold while a recommended one-line config change breaks their app.
- **Status-claim sweep, after the answer-claim sweep missed a whole sentence shape** — §5's summary still read "Q4 is the only one open" one paragraph below the text establishing Q6 as open and blocking. The earlier sweep was keyed on Q6's *answer* (one/two, cut, ships one) and could not match a sentence about its *status*. Widened to anything asserting what is open, blocking, settled, or clear to proceed, and it found a second cluster the first shape would never have caught: **three places said Q6 blocks FIX-548's *re-approval*** when the position at the time was that Q6 does not block it and the *implementation* is what waits — a status error pointing the opposite way, capable of withholding an approval that was ready. *Q6 still does not block that re-approval; but "the re-approval is safe", which this entry went on to assert, was **superseded two rounds later** and is recorded below — the separation between "not blocked by Q6" and "ready" is the whole point, and this entry collapsed it again while fixing the reverse error.* Also narrowed Q5's "FIX-1159 is unblocked", too broad a claim for one question to make.
- **The guest branch could not complete at all, and the boundary that caused it was mine.** Keying the resolver fix on *authorship* ("write no config we did not author") was wider than its hazard, which is **inheritance** and belongs to the host-level resolver alone. Verified: `resolveRuntimeSource` returns on a located config **before** `discoverFlows` — exclusive, not preferential — so the handed-back registration line meant **nothing we author is ever imported**; `serve` passes `requireConfig: true` and has no `--no-config`; `--flow-dir` is rejected outright; `--no-config` runs a different app. **A standing check required "on both authorship branches" therefore had a guest arm that could not be run** — worse than a false pass, which at least returns something. Re-keyed on the hazard, so the config falls under theme 6's additive contract like `.gitignore` and `package.json`: registration and an absent `devtool` block are **applied**, a *present* `devtool` block is handed over, the host-level resolver is still never written. **Fourth consequence of the resolver work** (DevTool listing → additive break → this → `modelResolver` is a single app-level option, so the guest's demo runs on *their* resolver and nothing yet says its model must be one they can serve). Conflicts with FIX-1159's decision 1, flagged not edited.
- **A production control that could not notice its condition clearing.** Theme 6 (c) narrowed `start` to loopback while the prose claimed the app "does not serve off-host *until* authentication is configured" — a conditional implemented as a constant, so the developer who does what theme 8 asks deploys and is unreachable, told nothing. It lands wrong in *both* directions on the same deployment mode, so no fixed value is right. Named by contrast with the second-process branch, where `assertNetworkBindIsAuthenticated` **is** the condition and clears itself; greenfield's `start` is a script argument and cannot ask. Rule: the production bind must be condition-linked, mechanism FIX-548's. **Generalised into theme 8 as the third question under the matrix** — *can the justifying condition ever clear?* — which is what separates a `dev` bind (correctly fixed) from a `start` bind (wrong by construction). §1 gained the mirror assertion: with a resolver configured, production **must** be reachable off-host.
- **Index and graph sweep, after a readiness claim survived three rounds in a table cell.** FIX-548's row still read "safe to take now — a mechanical set" after that claim was retracted in three prose locations; it is a scope increase (Small → Medium), a **reversed** decision (verified: `providerPreference` is consulted only inside `resolveIntent`, so a declared `provider/model` never reaches it), and a new **product statement**. Rows are the shape a prose sweep skims. Same sweep, reading Linear rather than the document: **FIX-1186 is a sub-issue of the epic and had no index row at all** — the index failing at its only job — and FIX-548 is `blocks`-blocked by FIX-1159, FIX-1160 **and FIX-1162**, the last of which this document forbids in bold. All flagged, not reconciled; the epic does not edit the graph. Q6 also carried a live trap: **two** of its three options begin "ship one", so an answer from memory of the withdrawn ask selects (c) while sounding like (b).
- **Non-author pass over themes 5/6/8 — every code-resting claim confirmed, every finding in how rules are *keyed*.** Exactly the split predicted, and five findings followed. **(1)** The credential's startup refusal in the flow file was right about coverage and wrong about **blast radius**, which runs along *whose module graph imports our flow file*: on the guest branch their config imports it, `loadFsdevConfig` wraps the throw into a config-load failure, and **their whole app dies without `.env.local`**. Its check confirmed it *by observing the harm* — no bystander flow in the fixture. Split: startup refusal on the author branch, **request-time** refusal in our own resolver on the guest branch. **(2)** Exception (c)'s `start` half **withdrawn** — redundant against theme 8's config refusal, and harmful because *"a platform deploy never runs `next start`"* is false of Docker/Render/Railway/Fly/Heroku/App Runner, with `-H` carrying no env binding so `HOST=0.0.0.0` cannot override it: the container binds loopback and reads as dead. It also **falsified a product statement already relayed to the owner**; corrected in theme 8. **(3)** The standing check was keyed to topology × authorship, both brownfield-internal, leaving theme 9's **greenfield shipper** exempt from its own block — re-keyed to **shipper × host**, and *"greenfield can always run what it just wrote"* withdrawn (true of files, false of `fsdev dev`). **(4)** The `devtool` block is per-flow in the reasoning and **app-global in the type** — one `window.__FSD_DEVTOOL_CONFIG__` for every flow — so an *existing* block is handed over rather than overwritten. *The first fix over-corrected to "never applied", which broke the standing check requiring `fsdev dev` to answer an authenticated call, and the printed next step with it; corrected to **absent → apply, present → hand over**, since with no block present there is nothing of theirs to disturb.* **(5)** Theme 8's production refusal was a fourth reader of "is this flow authenticated" with **no stated predicate**, passing because its only scenario was greenfield where all readings agree; predicate now stated once, per-flow, matching the bind guard. *One flag it raised was refuted before folding: `@flow-state-dev/devtool`'s `publishConfig` rewrites the exports map, so the published package is fine.*
- **The pair, not the rule, was wrong: a pinned model through a resolver we do not own.** FIX-1159 pinned a concrete `provider/model` (correct alone — the alternative threw at construction) and resolver installation was keyed to authorship (correct alone — it fixed the additive break). Together: the guest's demo runs on **their** app-level `modelResolver` with **our** hardcoded model, and if it is unrecognised every advertised command fails before streaming, so the guest proof cannot pass. **Verified the remedy question rather than assuming it — `ModelResolver` is a callable plus `resolveId`, with no `supports()` and no enumeration, and providers load lazily, so a resolver cannot be interrogated and a successful resolution is not proof.** So: invoke the demo once end to end during the run and **refuse with remediation** naming the resolver. Generalised to a standing question — *what else do we pin that the host also decides?* — with the credential variable name, the store, module format, the 22.18 floor, and `handleExecuteAction`'s principal path left open as candidates. **Two independent workers hit this class tonight**, so it is recorded as a check, not an anecdote.
- **Three corrections that had landed in the prose but not in the assertion beside it — the durable shape of the round.** Each of the two premises the previous pass flagged as unconfirmable produced a real defect within the hour, which is the sweep working at the only level it can: naming where it cannot see. **(1)** The credential refusal's check still demanded startup failure on **both** branches, sitting directly above the paragraphs explaining why an import-time throw takes down the guest's whole config. Split: author branch proves startup failure; guest branch proves the run **starts**, our flow **refuses**, and **a bystander flow of the host's still serves** — that last clause being the only assertion that fails if an implementer regresses to the throw. **(2)** The `devtool` reversal was over-corrected: "never applied" contradicted Q5's absent/present split and broke this theme's own standing check, which requires `fsdev dev` to answer an **authenticated** call. A rule that fails a check the same theme mandates is not cautious. **(3)** `"greenfield can always run what it just wrote"` was withdrawn in theme 5 and still standing verbatim in theme 6's rendering constraint, where a FIX-548 implementer would have read it as licence to skip the runtime command check — re-creating the unchecked greenfield cell the re-keying existed to close. **The rule: the explanation and the check are different artifacts, and only one of them runs.** Swept on that basis, which found one more — theme 8's production-refusal predicate was falsifiable nowhere, since greenfield has a single flow and per-flow, any-flow and host-level readings all agree there; asserted now on the guest fixture, where an **any-flow** reading would refuse the host's entire app in production.
- **Attribution sweep** — every "the owner's" / "your call" line checked against an artifact. Q2's and Q3's decisions evidenced (epic PR comment, 2026-08-14) and now cite it; Q1 marked as the coordinator's from the objective; the brownfield direction change evidenced (2026-08-15); the one-template cut unevidenced and already reopened as Q6. No further claims reopened — three clean, two already corrected.
- **The fifth check-that-cannot-fail, found inside the fix for the fourth.** Codex, at `91f1c4f`: the production-guard assertion the previous entry placed on the guest fixture targets our own demo flow, which that branch requires to carry a **per-flow credential resolver** — so an uncredentialed request is refused by *that* resolver, in development as much as in production, and the check is green whether the production guard is correct, wrong, or absent. **Verified and found wider than reported**: theme 8's predicate makes our guest flow *authenticated*, so the refusal was never going to reach it, and the refusal's carrier is the **generated config**, which the guest branch does not write — the scenario could not produce the behaviour it asserted. Moved to the **author** branch and restated by **what turns it red**: three flows in a production build — our credentialed flow, **a default-resolver flow the guard must refuse**, and an **authenticated bystander it must not** — so an absent guard, an any-flow broadening, and a host-level narrowing each fail it, and only the stated per-flow reading passes. The guest fixture keeps its real result under its real name (the credential rail and theme 6's additive promise). **Left open rather than decided:** whether a flow governed only by the *host-level* resolver counts as authenticated here — theme 8's predicate says no, theme 5 installs one on the author branch expressly to cover later flows, and the two disagree about the same flow. *The class is now five for five caught by a reader, never the author, and three of the five landed on a fix made in the same session.*
- **The rail was measured instead of reasoned, and four of this document's claims about it were false.** A POC served a real three-flow app through `@flow-state-dev/node` and invoked `assertNetworkBindIsAuthenticated` as `fsdev serve` does. **(1)** Detection is per-flow, **enforcement is whole-app** — a properly-authenticating bystander is refused along with the offender, so *"flows that authenticate properly continue to serve"* is false; the any-flow blast radius is not a reading we can choose against, it is what ships. **(2)** The trigger is the **bind host**, not the environment — no `NODE_ENV` check exists anywhere on the path, so `--host 127.0.0.1` in production is exempt and `0.0.0.0` in development is refused. **(3)** **`serve()` never calls the guard**; only the CLI does — so a host app importing our flow, which is this epic's entire brownfield shape, has no rail on its path, and neither does the Next mounted route. **(4)** A credentialed flow returns the same 401 with the guard present, removed, or per-flow, so it carries **zero** information about it; the discriminator is the default-resolver flow, which returns `202` and logs `userId: 'attacker'` when the guard is removed. **Consequence: the third product statement in a row was false, and this document stopped making one** — the behaviour is now **§5 Q7**, the owner's, with the three forks priced. Swept the premise rather than the wording: theme 6 exception (c)'s redundancy argument collapsed with the control (the withdrawal stands on harm), theme 5's negative list and §1's greenfield production assertion both named a control rather than a behaviour, and the release-check mirror survived because it asserts an **absence**. *The lesson is not "verify more". It is that every false version of this promise was produced by deriving behaviour from our own rules, and the derivation never once failed loudly.*
- **Two structural findings folded, one held.** The `devtool` boundary still said "the registration line is the only edit" three bullets under the correction that added a second — **a fix applied to one member of a pair**, now this document's most common defect shape, and an implementer following it would have failed the authenticated `fsdev dev` check this same theme mandates. And the epic was **dictating a child spec's correction** at theme 5's citation of FIX-1159's decision 1; reduced to stating the invariant and flagging the conflict for routing. **Held pending measurement:** whether the author branch's mandated host-level resolver counts as authentication to the bind guard — `bind-guard.ts` documents its own host-level fallback as a known false positive, and if that holds the generated app can never serve on a network interface whatever the developer configures. The author-branch fixture assertion is **withdrawn rather than defended** until that verdict lands.
- **The impossibility alarm was refuted by measurement, and what replaced it is worse.** The concern — that the author branch's mandated host-level resolver made a network bind unreachable forever — was raised here and is **withdrawn**. `executeServeCommand` run across five configurations on `origin/main @ f56c6b216`: the guard **does** refuse a genuinely host-authenticated app (a true false positive, proved by a negative control — the same resolver moved per-flow binds and enforces correctly), and the **mixed** case refuses whole-app, naming only the inheriting flow while the correctly-configured one also stops serving. But **two escapes work**: `--allow-unauthenticated`, after which the app binds *and still enforces auth*, and a hand-written `serve()` entrypoint the guard never sees. Awkward, not impossible. **What survives is the real hazard: the sanctioned escape is a flag named `--allow-unauthenticated`, applied to a fully authenticated app, disabling the guard wholesale — so a flow added later with no authentication binds silently.** Documented as a known limit at `packages/node/src/bind-guard.ts:14-18` (`packages/node`, not `packages/engine`). Q7 gains a fourth priced option, the named minimum fix: pass the app's `resolvePrincipal` into `assertNetworkBindIsAuthenticated` and judge a flow by its **effective** resolver per `pickPrincipalResolver`'s precedence. *Recorded as a correction of our own alarm, not of a reviewer's: the document is better for being right than for being consistent with the fear that motivated the check.* Three gaps declared unknown: `authentication` declared without `resolvePrincipal`, non-HTTP adapters under `fsdev serve`, and `tsx`-vs-`dist`.
- **The remedy had inherited the boundary of the artifact that motivated it — the ninth instance, in a new costume.** Q7's fourth fork asked whether to guard `serve()`. **It was aimed at the wrong path**: plain-Node brownfield already enters through the guarded `fsdev serve` CLI, while **greenfield Next — the headline entry path — mounts through `createNextHandler` and touches neither `serve()` nor the CLI**, as does brownfield Next. The fix would have protected what was already protected and left both exposed paths exposed. *Cause: the measurement ran through `fsdev serve` because that is where the guard lives, the conclusion was framed in `serve()` terms, and the remedy followed the frame rather than the exposure.* Rewritten to the real question — **where can this be enforced at all** — under the constraint already measured under Q5 (a Next handler has **no peer address**, so no network-position control exists there at any price): (A) `createNextHandler` refuses a default-resolver flow unless opted in; (B) the same, gated on environment; (C) accept it and say so. **Recommendation (A)**, and it **constrains fork (2)** — "key on the bind address" cannot be the whole answer where there is no bind. The honest headline the owner gets: *the only place we enforce this today is the CLI, and two of three topologies do not use the CLI for the route that matters.*
- **The mandate outlived the narrative that withdrew it.** Theme 8 established that the production promise was false and deferred the behaviour to Q7, and **still directed workers to implement a generated-config refusal**, repeating it in the control matrix — so a child issue could have preempted the owner's decision by following a sentence the surrounding paragraphs had already retracted. Marked pending Q7 at all three sites. *Same shape as the DevTool boundary: the correction was applied to one member of a pair.* **And FIX-1159 was gated on Q6 rather than noted as affected** — option (b) gives it a new host shape and its own proof, and it is first in the merge order, so a reopen invalidates what FIX-1160 packaged and FIX-548 conformed to. Q6 now gates two issues.
- **Two of Q7's four forks settled by the coordinator, so the owner sees one question rather than four.** **(2) Keep the bind address and stop describing it as production** — no product content in it: a description being made to match a mechanism, against the alternative of inventing a deployment signal we do not have. Carried forward as a constraint on every artifact this epic ships: nothing describes this control in terms of production or deployment. **(3) Do the named minimum fix**, filed as **FIX-1189**, settled on the author's own framing that only sequencing would have changed the recommendation — which makes it engineering, not product. Non-blocking, with one standing constraint until it lands: **nothing this epic ships may print or document `--allow-unauthenticated` as the remedy for a correctly-authenticated app.** What reaches the owner is **(1) + (4) combined**, since separately they are mechanism and together they are one choice about what a developer meets when their demo is unguarded. *Also reconciled: Q6's heading still read "blocks FIX-548's implementation" a round after its body was corrected to gate FIX-1159 too — the fix-applied-to-one-member-of-a-pair defect, this time on a heading, found by re-reading the entry rather than the edit.*
