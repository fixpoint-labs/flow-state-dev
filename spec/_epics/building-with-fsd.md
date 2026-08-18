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
  would otherwise read as a refusal.
- *FIX-1159, second-process path* — the same against an existing plain-Node project: the printed
  command starts FSD, a call to it **carrying the generated credential** streams a real model
  response, and the project's own server keeps running. **A call without it is refused** — that
  negative half is what makes this a check of theme 8's control rather than of the happy path. **This must not be dropped as redundant with the run above.** It is a different
  host and a different shape (theme 8), and **with the Node template cut it is the epic's only Node
  coverage of any kind** — without it, Node detection and the second-process instruction can be
  entirely broken while every other proof here passes.
- *FIX-548* — in an empty directory, `npm create flow-state my-app` plus the dev command it prints
  yields a streamed model response from the chat page the template ships, with the provider key
  supplied at the prompt the way a real user supplies it. **The same run must assert that
  `create-next-app`'s own `AGENTS.md` block and its `CLAUDE.md` survive the scaffold**, and that
  `.env.local` is genuinely ignored (`git check-ignore`, not a read of the file). **This too must
  not be dropped:** a streaming chat page proves nothing about what the scaffolder overwrote on the
  way there, and greenfield is the path where we author both sides, so it is the one place theme
  6's guarantee is exercised end to end. **And the loopback bind is asserted negatively — a request
  from a non-loopback address must fail to connect.** Found by sweeping for the same defect as the
  mounted-route one: the bind is greenfield's *only* control (theme 8), and a chat page streaming
  over `localhost` proves nothing about it, because the page streams identically whether the dev
  script carries the flag or the exception was never implemented at all.
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
   under the secured config — both topology branches, every line.** Theme 8's credential is not a
   change to one route; it changes the `FlowState` every printed command loads. Walked end to end:

   - **`fsdev dev` breaks unless the generated config says so.** The DevTool page loads, and its
     API actions then fail authentication, because `packages/cli/src/commands/dev.ts` injects
     **only** the fields a config explicitly declares under `devtool` — a `userId` and a
     `bearerToken`. The mechanism exists for exactly this case (its own comment: *"Injected into
     the DevTool page by serve() so a secured flow is debuggable without hand-editing DevTool
     settings"*), so **the generated config declares `devtool` from the same source as the
     resolver**. Both topology branches print `fsdev dev`, so this binds both.

     **"Same environment variable" is not sufficient, and the audit of it found a worse failure
     than a rename.** The generated config **reads the credential once into a single binding, and
     both the resolver and the `devtool` block reference that binding** — never two independent
     `process.env` reads — **and refuses to start when it is missing or empty.** Four ways the two
     sides diverge otherwise, all silent: a rename in one place; a `??` fallback on one side; a
     **partial declaration**, since `DevToolConnectionConfig` makes both fields optional and
     `fsdev dev` gates on `userId` **or** `bearerToken` being non-empty, so a config with an
     identity and an absent token passes the gate and then fails auth looking like a bad key; and
     the serious one — **an unset variable makes a naive equality accept everyone**, because a
     request carrying no credential compares equal to an absent expected value, so the flow reads
     as secured while being open. Refusing at startup is what makes that unrepresentable, rather
     than a thing the reader has to remember. **And that refusal is itself asserted** — with the
     variable unset, the config must fail to start — because a mitigation nobody exercises is the
     defect it was written to prevent, wearing a fix's clothes. Found by the same sweep that added
     the two negative assertions in §1.
   - **`fsdev run` is unaffected**, on both branches: it calls `runAction` in-process with its own
     `cli-user` identity and never resolves a principal, so it does not cross the secured surface.
   - **The second-process branch's own call does cross it.** `fsdev serve` starts a real HTTP
     server, so the example call the block prints — and §1's proof of that path — carries the
     credential.
   - **And securing the flow *unlocks* a bind the rail used to refuse.** `fsdev serve` calls
     `assertNetworkBindIsAuthenticated`, which refuses a network host while the resolver is the
     default. Configuring one satisfies it, so a developer who drops `--host 127.0.0.1` now gets a
     network bind that was previously blocked. The printed command keeps the flag; the point is
     that the rail stopped being the backstop the moment we stopped relying on it.

   **So the printed block is under a standing goal check, not a rule that fires when someone
   notices.** Every command the block prints is run against the emitted project, on **both**
   topology branches, and asserted on **real behaviour rather than exit status** — the DevTool page
   answers an authenticated API call, the printed flow invocation returns a streamed model
   response, the second-process call is accepted with the credential and refused without it. It is
   a standing check because "re-walk the block whenever a decision changes the `FlowState`" is
   itself a rule waiting on someone spotting the trigger, which is the failure class this epic has
   now hit four times, one level up. **The standing check subsumes that trigger, so the trigger is
   gone rather than kept alongside it** — two rules covering one hazard is how the weaker one
   becomes the one people rely on.

   **The finding that earns it, stated as the reason rather than as a fixed bug: securing the flow
   silently removed a rail.** `fsdev serve` calls `assertNetworkBindIsAuthenticated`, which refuses
   a network bind *while the resolver is the default*. Configuring a resolver satisfies it, so
   adding a control **took one away** — a bind that had been refused is now permitted. Nobody asked
   about that, no review reported it, and no check in the epic would have caught it; it surfaced
   only because the commands were walked one by one. A control that removes another control is not
   a rare shape, and running what we print is the cheapest thing that sees it.

   **The companion rule, which cost us three more findings before it was written down: every
   control is proved by its own absence, not by its presence.** A check that only exercises the
   protected case passes identically whether the control is installed or missing — so the scenario
   that motivated the control is exactly the scenario the check cannot fail in. Each control this
   epic claims therefore carries a negative assertion: the mounted route refuses an uncredentialed
   request **and invokes no model** (a 200 with an error body is not a refusal); the greenfield dev
   server refuses a non-loopback connection; the generated config refuses to start with the
   credential variable unset.

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

     **(c) The stock `dev` script, greenfield only, narrowed to loopback.** `create-next-app`
     writes `scripts.dev`; the template rewrites its value to bind `127.0.0.1` (theme 8). **This is
     a third exception, stated as one rather than smuggled into (a) or (b), because it fits
     neither** — the script's purpose is to be *run*, not replaced, so (a) does not reach it, and
     (b) is exactly the rule it breaks, since we are changing the value of a key we do not own.
     Pretending otherwise would turn (a) into "anything `create-next-app` wrote that we find
     inconvenient", and the tightness of this set is the whole reason it is trustworthy.

     **What justifies it is that no other control exists on this path.** The greenfield demo is a
     **browser** page calling the mounted route, so the credential that protects brownfield cannot
     protect greenfield: any token the page can use is a token anyone who can load the page can
     read, and on an exposed dev server the attacker can load the page. **Loopback is the only
     control that works when the client is a browser.** Against that, the alternatives are worse:
     printing `npm run dev -- --hostname 127.0.0.1` leaves the plain `npm run dev` that
     `create-next-app` itself advertises live and exposed, and adding a second script under a key
     we own does the same while also putting two dev commands in a four-second-old project.

     **The exception is deliberately narrow.** Greenfield only — a project we created, holding no
     developer content yet. One key, whose stock value we caused to exist seconds earlier. The edit
     only ever *narrows* a bind, breaks nothing, and is a one-word revert the developer can make.
     **It does not reach brownfield**, where the script is theirs, the project is theirs, and theme
     6's promise is the one the objective actually sells.
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
   requirement is gone with the Node template (theme 2)**: the second-process shape now appears in
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
   different adapter loses it silently. We cut the Node template partly over this exposure and it
   survived in the path we kept, wearing a different adapter — which is the second time a safety
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

   **The resulting property, per entry path, in the same explicit form.** *Greenfield*: an
   unauthenticated caller elsewhere on the network **cannot reach the endpoint at all** — nothing
   is listening for them — and correspondingly, **nothing else stops them if the developer removes
   the flag**, since the flow itself accepts any caller. *Brownfield*: the endpoint **is** reachable
   and probeable, and every call without the secret is **refused** — no model invocation, no key
   spend, no acting as another user. **Greenfield does not also carry a credential**, and an earlier
   round claimed it did; one control each, chosen because it is the one that works on that path. **Brownfield cannot be fixed the same way** — theme
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
   network, and what protects it is the secret rather than the absence of a route. **The two paths
   therefore carry one control each, and they are not the same control**: greenfield binds loopback
   (its browser client makes a credential unusable), brownfield requires a credential (its host's
   dev script is not ours to bind). Neither is a weaker copy of the other and neither stacks on the
   other — an earlier round claimed greenfield had "both layers", which was wrong in the same move
   that wrongly claimed the dev script was ours. **What each leaves open is different, and that is
   the honest comparison:** greenfield's endpoint is unreachable off-host but would be wide open if
   the developer removes the flag; brownfield's stays reachable and probeable but refuses every
   caller without the secret. Disclosed rather than engineered away.

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

**Built:** an end-state sketch — the file tree a developer ends up with from the template, the
file-tree diffs a brownfield run produces against an existing Next.js app and an existing
plain-Node app, and a terminal transcript of each path end to end. Drawn, not run: what this epic
ships is *what a developer sees and what files land in their repo*, and whether that is right is
judged by reading it.

**See it:** the sketch is no longer reproduced here. It was ~200 lines of file trees, config
detail and transcripts owned by FIX-548 and FIX-1159, in a section the objective gate signs off —
the same accumulation theme 9 and §1 were both cut for. Everything it established that binds more
than one issue has been moved to the theme that owns it: the **two-file mount** and the **required
store profile** to theme 9 (b), the **no-generated-Node-entrypoint** reasoning and the bind guard
to theme 8, the **printed-command** rules to theme 5. The per-issue file lists live in the child
specs, which are where they can be kept true.

**Showed:** three things, each of which became binding elsewhere rather than staying an
observation here. The two templates shared almost nothing but `fsdev.config.ts`, `flows/`,
`.env.local` and the agent-instructions file — a common set smaller than either template, which is
why the shared shape became a **contract FIX-1159 authors** (theme 9) rather than a template the
brownfield skill can never reach. The next-steps block has to name **two servers with different
jobs** and say which is which, or a first-hour user lands on a blank page (theme 5). And in a
Next.js app FSD can be a real mounted route while a plain-Node app gets a **second process**,
because nothing may edit an entrypoint it did not write — an asymmetry the prose had hidden, now
**theme 8**.

**Changed:** it added theme 5's one-next-steps-block clause and theme 6 (a run is additive over
what it touches); neither was visible in prose. Both survived the greenfield/brownfield split with
their guarantees intact and their mechanism replaced — the clearest evidence that what the diffs
surfaced was a property of the *situation* rather than of the command that used to implement it.

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| FIX-1159 | The brownfield knowledge — deterministic detection scripts, the install skill's **content**, the shared next-steps block, and **the wiring contract both entry paths satisfy** (theme 9) | spec | [#1310](https://github.com/fixpoint-labs/flow-state-dev/pull/1310) | — | In spec review — re-shaped to **brownfield only, no command of its own**; the earlier approval was retracted with the direction change. **Unblocked — Q5 resolved by constraint**: the run configures a non-default principal resolver, mechanism this issue's. Also gains the devtool peer fix (theme 5) and the mounted-route proof (theme 9 (b)) |
| FIX-1162 | Register the npm names the launch needs — the short CLI entry name and the scaffolding name | spec | [#1313](https://github.com/fixpoint-labs/flow-state-dev/pull/1313) | — | In spec review — **both names now registered at `0.0.0` to a personal account**; what remains is the publishing identity's write access (`npm owner add` / transfer) and the unproven `@flow-state-dev` scope. Owner operations, not agent work |
| FIX-548 | `create-flow-state` — the deterministic greenfield path; **one** template (Next.js chat app), owned end to end | spec | [#1312](https://github.com/fixpoint-labs/flow-state-dev/pull/1312) | — | Spec complete, approved at `404e82c` — **approval needs re-taking**: theme 9 now requires a pnpm-isolated install of the emitted template in its goal check (posted to #1312; its spec is not edited by the epic) |
| FIX-1160 | The authoring pack **and the plugin that distributes the install skill** — agent-instructions file, authoring skills, install skill | spec | [#1311](https://github.com/fixpoint-labs/flow-state-dev/pull/1311) | — | Spec complete, approved at `dd9b656` — **approval needs re-taking**: theme 9 (d) hands it the agent-instructions block's normalization and equality check (posted to #1311). Scope had already grown: it is the brownfield path's only delivery channel |

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

**Dependencies — and these are two different kinds of thing, so they are listed separately.** A
reader scanning one list cannot tell a **merge-order edge** from a **release gate**, and conflating
them is how an issue gets blocked from merging on an operation that only its release needs. That
has now happened twice: once here, and once at issue altitude where FIX-1186 was wired to block
FIX-548's *implementation* rather than its release.

**Merge-order edges — these gate merge, and nothing else.**

- **FIX-1159 → FIX-1160.** FIX-1160 packages content FIX-1159 authors.
- **FIX-1159 → FIX-548**, for the shared next-steps block (theme 5) **and the wiring contract the
  template conforms to (theme 9)** — firmer than the block alone, since it constrains the
  template's own files rather than only what it prints.
- **FIX-1160 → FIX-548** (theme 9): FIX-1160 authors the agent-instructions content the template
  ships, and without that edge a template landing first ships a draft that drifts.

That makes FIX-548 the last of the four, on a `FIX-1159 → FIX-1160 → FIX-548` critical path. **None
of these is an accepted deferral** — each is a real constraint on merge, and each pair can be
specced in parallel.

**Release gates — these gate *shipping*, and block no issue's spec, build, or merge.**

- **The publishing identity can write every package the quickstarts install** (theme 1). **FIX-1162
  is not a merge-order edge on FIX-548 and must not be treated as one**: the names are held,
  nothing waits on a decision, and neither FIX-1162's spec approval nor its completion gates
  FIX-548's build or merge. What it gates is the release, and it is an owner credential operation.

**And one accepted deferral, which is neither:** the cut Node template. Nothing blocks it and
nothing starts when something else lands — v1 simply does not ship it. It appears here only
because a dependency column cannot distinguish "blocked by X" from "deliberately not built", and
they mean opposite things.

**Folded this pass — the naming record, kept because two wrong names were in this document and
one of them is somebody else's package.** The scaffolder is **`create-flow-state`**, invoked as
`npm create flow-state my-app`. It replaces `create-fsdev-app` (a compromise adopted while the
short name was believed unobtainable) and, before that, `create-fsd-app`.
**`create-fsd-app` is not ours and never will be:** `create-fsd-app@1.1.2` is a React/Vite
starter published 2024-10-18 by an unrelated maintainer (`keyready`), verified against
`registry.npmjs.org`. Any sentence implying we hold or will hold it is false. **`create-flow-state`
and `fsdev` are now both registered at `0.0.0` to `jnhoffner`** — a personal account, which is the
fact theme 1's release gate turns on, and it is not the same fact as CI being able to publish them.
Publishing unscoped is load-bearing rather than cosmetic: `npm create <name>` resolves only to the
unscoped `create-<name>`.

**Raised up but not folded here** — each belongs to a separate pass, and none is a gap in this
one:

- **Whether the `@flow-state-dev/` npm scope is ours at all** is still open and is the larger half
  of FIX-1162's finding: nothing under it has ever been published, and an npm scope belongs to
  whoever registers the matching organization first. Two sibling specs lean on it as a safe
  fallback. **It is explicitly *not* recorded as confirmed, because the obvious check cannot
  establish it:** `/-/org/<name>/package` returns 200 with an empty body for scopes that exist and
  scopes that do not alike, so a 200 there is not evidence. **The cheap proof is publishing any one
  scoped package at `0.0.0`** — that is the check to run, and until it runs the scope is an
  assumption. This matters more than it did, because theme 1's release gate now depends on the
  publishing identity's write access across the whole `@flow-state-dev/*` set.
- **FIX-1160's POC established that Claude Code has no bare-URL plugin install** — the path is
  `plugin marketplace add <source>` then `plugin install`, so a marketplace manifest is a
  required distribution artifact rather than a public listing. Consistent with §5 Q2 as written;
  it sharpens Q4 rather than reopening Q2.

## 5. Open cross-cutting questions

Q1–Q3 and Q5 are **decided** and stay here with their answers, so no issue reopens them. **Q4 is
the only one open**, and it blocks nothing — it exists because the split changed what an
already-made decision costs. **Q5 was raised as a product fork and resolved as an engineering
one**, because both of the cheaper options turned out to be unavailable rather than merely
unattractive; it is kept in full so neither is proposed again.

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
the generated config reads it **by environment-variable name** in both the principal resolver and
the `devtool` block. No literal secret appears in this document, in the template, in a printed
command, or in any committed file. **The mechanism is FIX-1159's** within that constraint;
greenfield does **not** also take a credential — its demo is a browser page, so a token it could
present is one an attacker can read from the same page; loopback is its whole control, and theme 8
states the comparison exactly.

**What this closed and what it did not.** Closed: an unauthenticated caller is refused, so a
stranger on the same network cannot spend the developer's provider key or act as another user.
Not closed: the port still listens on every interface, because it is their dev server and theme 6
forbids us editing it. The endpoint remains reachable and probeable; the secret is what stands
between a caller and the flow, rather than the absence of a route. **The question this section
asked is answered — yes, we require a credential — while the guarantee is narrower than
greenfield's, which has both layers.** That is disclosed in theme 8 rather than treated as an open
fork, because the only option that would close it is refusing to mount a route in a brownfield Next
app at all, which trades the epic's headline integration for defence in depth over a control that
already works.

**It also broke the next line of its own next-steps block, which is recorded here because the
lesson generalizes.** Securing the `FlowState` meant `fsdev dev` opened a DevTool whose API calls
failed authentication — the command the developer is told to run immediately after — and, less
visibly, it satisfied `assertNetworkBindIsAuthenticated` and so **removed** a rail that had been
refusing `fsdev serve` a network bind. Theme 5 now keeps the printed block under a **standing**
goal check on both topology branches rather than a trigger someone has to notice.

**What this costs, so the owner sees it rather than discovers it.** The brownfield first run is
unchanged for the printed CLI command, which runs in-process and never crosses HTTP. It changes for
anyone who calls the mounted route directly — a `curl`, or their own UI — who now needs the value
from `.env.local`. That is a real if small tax on the first hour, and it is the price of the
endpoint not being open. **Not a gate**: no issue waits on it, and FIX-1159 is unblocked.

**If this turns out wrong**, it is wrong in the direction of friction rather than exposure: a
developer hits a 401 on their own machine and has to look in `.env.local`. The alternative was
wrong in the direction of a stranger spending their credits, which is the failure this epic's whole
brownfield pitch — *we will not damage your repo* — cannot survive.

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
- **Epic review, round 2** — theme 6's exceptions enumerated in theme 6 itself (two at the time; a
  third was added later): a stock
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
- **Theme 9 became one mechanism for all three shared artifacts** — the wiring contract, the
  agent-instructions block and the next-steps block (theme 5's source, which had no carrier or
  check at all). Each declares author, kind, carrier and check; **kind** is *specification*
  (conformance, checked behaviourally) or *source block* (canonical text with declared
  substitutions, embedded verbatim, checked by digest). Two rules close the class the previous
  attempts kept reopening: both sides of a comparison are recomputed from content, and everything
  that varies is a declared substitution or lives outside the delimiters — the *file* varies, the
  *block* does not. Fixes the canonical-only digest, which passed for a stale shipper because the
  shipper's body was never hashed, and dissolves FIX-1159's renderer problem: a Markdown skill
  embeds the block and substitutes, so there is nothing to call.
- **Four fixes that made theme 9 implementable** — the whole-block digest was self-referential
  (writing the value changed the bytes hashed), so the hashed body became the block **with the
  marker line stripped** (superseded — see the entry below); the
  agent-instructions block created an **ownership cycle** (FIX-1160 authors it, but FIX-1159's
  skill ships it and lands first), resolved by **co-location** — FIX-1160 embeds it at packaging
  into a placeholder the skill carries, which runs with the existing edge instead of against it;
  a **Node 20.9–21 scaffold** completed and left an unrunnable app, so both paths now refuse
  before writing and FIX-548's goal check exercises the refusal; and theme 6's `package.json`
  guarantee promised untouched **formatting**, which the mandatory package-manager install
  rewrites, so it now promises semantic key/value preservation as exception (b) always said.
- **The digest mechanism was deleted rather than fixed a fifth time** — the stripped marker was
  never compared to anything, so any stale or arbitrary value passed. Asked what job the marker
  did that the comparison did not, the answer was none: every shipper's canonical text is in this
  monorepo, so no shipper ever self-checks without it. **All five defects were defects in a
  *stored value*, not in the comparison**, so the value and the hashing both go and the check is
  normalized text equality (`node:crypto` no longer needed). Two other P2s in the same batch:
  rule 2 gained **conditional sections keyed on theme 8's two host topologies**, because
  package-manager substitution cannot turn a mounted-route process list into a second-process one
  and the block has two shippers — the epic's to widen, not FIX-1159's to work around; and
  **FIX-548's goal check gained a pnpm-isolated install of the emitted template**, since the
  dependency rule was asserted of the greenfield manifest while only the brownfield one was ever
  installed strictly.
- **Theme 9 cut roughly in half, and the mechanics went to the issues that own them** — it had
  reached 231 lines because five rounds of fixes each landed where the defect was found rather than
  where it belonged, which is not a reason to keep them in a coordination artifact. **The check now
  belongs to each artifact's author**, so normalization, placeholder syntax and the test are one
  implementation per artifact and cannot drift between shippers. The epic keeps ownership, ordering,
  and the invariant that binds a shipper who does not own the check — verbatim embedding, the two
  declared forms of variation, the closed topology key set, "embed every branch", and the
  isolated-install requirement on both manifests, which is here only because it binds the two issues
  symmetrically. FIX-1160 and FIX-548 both need their approvals re-taken.
- **The npm gate reframed, and a stale registry fact corrected** — `create-flow-state` and `fsdev`
  are registered at `0.0.0`, but to a **personal** account, so the release gate is not "acquire the
  name": it is that the identity CI publishes with can write every package the quickstarts install.
  The `@flow-state-dev` scope stays **unconfirmed** — `/-/org/<name>/package` returns 200 for
  strings that exist and ones that do not, so the cheap proof is publishing one scoped package.
  Also: `fsdev run` takes caller identity as its own parameter, not from `--input`, so both printed
  commands dropped the `userId` key they could never have set.
- **A security finding, and the runtime floor I broke in the previous turn.** The generated demo
  runs on the default resolver, whose only protection is the loopback rail in
  `@flow-state-dev/node` — an adapter the mounted-route path never uses, since it is
  `createNextHandler` inside the developer's own `next dev`, which binds `0.0.0.0`. **The rule is
  now stated per *adapter* rather than per template** (theme 8), because we cut the Node template
  partly over this exposure and it survived in the path we kept. Greenfield is decided (our own
  `dev` script binds loopback, printed command unchanged); brownfield is **Q5**, since theme 6
  forbids rewriting a script the developer authored. **And the runtime floor: the rule had said
  "the higher of `>=22` and 22.18", but §1's only refusal check exercised 20.9–21, so the 22.18
  half never had one — then last turn's theme 9 compression dropped that half from the rule
  outright.** Restored as a single number, 22.18, with why it is not 22. §1's Proof block also cut
  from ~894 words to ~290: user-level observations only, with the two assertions nothing else
  carries — greenfield `AGENTS.md`/`CLAUDE.md` survival and the second-process Node coverage —
  kept as explicit must-not-drop sentences.
- **Q5 killed as a fork, not softened — and two more checks that could not fail.** The proposal to
  put the loopback guard in `createNextHandler` (code we own) instead of the bind (which we do not)
  was the right instinct and **fails on the signal**: a Next App Router handler gets a web
  `Request`, and `NextRequest` in `next@16.3.1` exposes no peer address, so the only inputs are
  spoofable headers. With ship-open-and-warn independently rejected — a disclosure is not a control
  — both cheap options were gone, so **Q5 resolves rather than escalates: the brownfield run
  configures a non-default principal resolver**, which is the condition the framework guard keys
  on. The withdrawn part of the earlier framing: comparing this to the development-only file store,
  which risks the developer's own data on their own disk, when this spends their provider
  credentials for anyone on the network and has no tenant boundary. Alongside it, **static provider
  wiring** entered the contract (Next bundles server code and breaks the resolver's dynamic
  `require()`, so the dependency rule can pass while the first browser request fails), with
  mounted-route proofs required to go **through the HTTP route** rather than `fsdev run`; and the
  **devtool `react ^19` peer** was ruled a theme 6 violation, fixed in our own manifest since the
  served assets never needed the consumer's React.
- **Securing the endpoint broke the tool the next printed line opens.** `fsdev dev` injects only
  the `devtool` fields a config explicitly declares, so a secured `FlowState` yields a DevTool whose
  API actions fail auth — the CLI has the mechanism precisely for this case and the generated config
  now uses it, reading the same environment variable as the resolver rather than copying a value.
  Walking the rest of the block found two more: `fsdev run` is unaffected (in-process, never
  resolves a principal), and `fsdev serve` **stops being refused** on a network host, because
  `assertNetworkBindIsAuthenticated` only refuses while the resolver is the default — **adding a
  control took one away**, which nothing in the epic would have caught. **Theme 5 now puts the
  printed block under a standing goal check** — every command, both branches, asserted on real
  behaviour — rather than a rule that fires when someone notices a trigger, since that is the same
  failure class one level up. Q5 also states the property plainly: the credential refuses unauthenticated
  callers, but the port still listens, so greenfield (loopback **and** credential) is strictly
  stronger than brownfield (credential only) — disclosed, not engineered away.
- **The walk became a standing check, and the credential wiring got an audit.** "Re-walk the block
  whenever a decision changes the `FlowState`" was itself a rule waiting on someone noticing the
  trigger — the failure class of the evening, one level up — so the printed block is now under a
  **standing** goal check: every command, both topology branches, against the emitted project,
  asserted on real behaviour rather than exit status. The conditional trigger is deleted rather
  than kept beside it. **The reason it earns its place is the `fsdev serve` finding: securing the
  flow satisfied `assertNetworkBindIsAuthenticated` and so removed a rail that had been refusing a
  network bind — adding a control took one away**, unasked and uncaught. Auditing the shared
  credential then found four silent divergences between the resolver and the `devtool` block, the
  worst being that an **unset** variable makes a naive equality accept every caller while the flow
  reads as secured; so the config reads it **once into a single binding** both sides reference and
  **refuses to start** when it is absent. Also recorded: the second-process alternative for
  brownfield Next is **rejected** — it trades the epic's headline integration for defence in depth
  over a control that already works (coordinator decision, not the owner's).
- **Greenfield's rail turned out to cost something, and the earlier claim that it was free was
  wrong.** `create-next-app` writes `package.json` *before* the template lands, so `scripts.dev` is
  a key we do not own and theme 6 (b) forbids changing its value — the previous round asserted the
  script was ours. It is now **theme 6 exception (c)**, stated as a third exception rather than
  stretched into (a), whose "stock placeholder meant to be replaced" does not describe a script
  meant to be *run*. What justifies it: the greenfield demo is a **browser** page, so any credential
  it can present is readable by anyone who can load the page — **a credential is not a control when
  the client is a browser**, which makes loopback the only rail available there, and makes the two
  paths' different controls a necessity rather than an inconsistency.
- **The author-owned check could not enforce its own invariant, because authors land first.** An
  upstream check over a downstream copy either demands a copy that has not landed or tolerates one
  that never will — it cannot tell *not yet* from *never*. Split the comparison from its invocation:
  **the author exports it, each shipper invokes it against its own copy in its own suite**, so the
  assertion lands exactly when the copy does. It asserts normalized **equality over the whole
  block**, so a trimmed conditional branch fails rather than passing a presence check.
- **§3 cut from ~210 lines to four.** It had become child-owned file trees, config detail and
  transcripts inside the gated section — the third length finding of the same shape. Moved rather
  than deleted: the two-file mount and the required store profile to theme 9 (b), and the sketch's
  three findings were already binding in themes 5, 8 and 9.
- **Greenfield is loopback-only, settled against the template's real data path.** The chat page is
  a `"use client"` component using `@flow-state-dev/react` over `@flow-state-dev/client`, which
  fetches and streams `/api/flows/*` **from the browser** — no server component of ours holds a
  secret in between, and a proxy layer would mean not using the React package. So a credential
  there is readable by anyone who can load the page: **greenfield carries one control, the loopback
  bind, not two.** The per-path property is now stated explicitly — greenfield's endpoint is
  unreachable off-host but unguarded if the flag is removed; brownfield's is reachable but refuses
  every caller without the secret. Also: theme 6's binding count corrected to **three** exceptions
  after (c) was added — a stale closed-set count is worse than none, because implementers are told
  to trust it.
- **Attribution corrected on the proof-strength trade.** The epic had called the goal-check
  downgrade — two of four proofs becoming single recorded agent runs — "the trade the owner made".
  It was not. The owner changed the **delivery mechanism** (brownfield becomes an agent skill);
  the proof-strength consequence is the **coordinator's** reading of that change, recommended and
  never put to them. Re-filed as an **open item**, marked reversible, with the cost of reversing it
  stated (a maintained fixture repo per host shape). It blocks nothing.
- **The credential guard was checking a proxy, and every control got a negative case.** The
  `.env.local` rule asked only whether the file was *already tracked* — which says nothing about a
  file that does not exist yet in a repo with no matching ignore rule, so the run would create an
  ordinary **untracked** file holding **two** secrets (the provider key, and since theme 8 the
  bearer secret) for the next `git add .` to commit. Now a **precondition**: before any credential
  is written, `git check-ignore` must confirm the path is effectively ignored, else append the rule
  and re-verify or refuse. **Third guard on this one file to check a proxy** — tracked-ness, then
  delimiter position, now existence; the property is "will git ignore this path" and only git
  answers it, since even reading `.gitignore` misses a later negation.
- **Sixth finding of the "rule with nothing checking it" shape, and the first to land on a fix made
  the same day.** The mounted-route proof exercised only the authenticated request — on the one path
  where the credential is the **only** control, and where a missing resolver means
  `defaultBodyUserIdPrincipalResolver` accepts and streams, so the positive check passed identically
  whether the wiring was right or absent. Now refuses an uncredentialed request **and asserts no
  model invocation**. Sweeping for the same defect found **two more**: the greenfield loopback bind
  (its only control, previously proved only by a page streaming over localhost) and the
  refuse-on-missing-credential rule added earlier the same evening. Theme 5 now states the rule —
  **every control is proved by its own absence** — and its timing: *adding a control creates a new
  opportunity to under-prove it, and the round that adds it is the round least likely to notice.*
- **Merge-order edges and release gates split into separate lists.** The dependency summary called
  the FIX-1162 edge "a real ordering constraint on merge" while theme 1 said it gates release only —
  enough for a coordinator to block FIX-548's merge on an owner credential operation. The same
  defect had already occurred at issue altitude (FIX-1186 wired to block FIX-548's implementation).
  A dependency column cannot distinguish "blocked by X" from "gates the release" from "deliberately
  not built", so all three are now listed apart and labelled.
