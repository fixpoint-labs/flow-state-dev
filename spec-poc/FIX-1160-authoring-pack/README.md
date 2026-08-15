# POC — can this repo ship an installable Claude plugin?

Throwaway. Lives on the never-merged spec branch for **FIX-1160**. Nothing here ships.

## The premises it checks

The epic recorded that FSD has **no packaging or publishing path for skills today** — no
`.claude-plugin/`, no marketplace manifest — and then scoped FIX-1160's plugin to
**install-by-URL only**. The whole plugin half of the spec rests on a premise nobody had
run: *that a marketplace manifest hosted in this repository produces a plugin a stranger
can actually install, and that its packaged skills load.*

Then the direction changed — brownfield became an agent skill, and this plugin became the
only channel it reaches anyone through. That added a second premise: *that a fifth skill,
one that runs before `AGENTS.md` exists rather than reading it, packages and loads the same
way — and that adding it requires no edit to a manifest the other issue does not own.*

## Run it

```bash
cd spec-poc/FIX-1160-authoring-pack/marketplace
claude plugin validate .
claude plugin validate ./plugins/flow-state-dev

# the full round trip (mutates ~/.claude — the last two lines undo it)
claude plugin marketplace add "$PWD"
claude plugin install flow-state-dev@flow-state-dev
claude plugin details flow-state-dev@flow-state-dev
claude plugin uninstall flow-state-dev@flow-state-dev
claude plugin marketplace remove flow-state-dev
```

To re-check that no bare-URL install exists, run these two against an empty marketplace
list — both fail with *"not found in any configured marketplace"*:

```bash
claude plugin install https://github.com/fixpoint-labs/flow-state-dev
claude plugin install fixpoint-labs/flow-state-dev
```

## What it showed (Claude Code v2.1.233)

**The premise holds.** A `.claude-plugin/marketplace.json` plus a plugin directory with its
own `.claude-plugin/plugin.json` and a `skills/<name>/SKILL.md` installs and exposes the
skill:

```
Component inventory
  Skills (2)  create-block, install-fsd
```

Six things worth carrying into the build:

1. **"Install by URL" means adding a *marketplace*.** There is no command that installs a
   bare plugin from a URL — the path is always `plugin marketplace add <source>` then
   `plugin install <plugin>@<marketplace>`. So shipping a marketplace manifest is not the
   same as taking a public listing, and it does not contradict the epic's decision. The
   distribution artifact is required; the directory listing is the thing we are declining.

   **Re-confirmed by running it, not by reading help text.** Both a full URL and an
   `owner/repo` shorthand were passed to `plugin install` directly:

   ```
   $ claude plugin install https://github.com/fixpoint-labs/flow-state-dev
   × Failed to install plugin: Plugin "https://github.com/fixpoint-labs/flow-state-dev"
     not found in any configured marketplace

   $ claude plugin install fixpoint-labs/flow-state-dev
   × Failed to install plugin: Plugin "fixpoint-labs/flow-state-dev"
     not found in any configured marketplace
   ```

   `plugin install <plugin>` resolves a *name* against configured marketplaces. The command
   that accepts a source is `plugin marketplace add <source>` — "Add a marketplace from a
   URL, path, or GitHub repo".

2. **`metadata.pluginRoot` passed validation and then failed the install.** With
   `"metadata": { "pluginRoot": "./plugins" }` and `"source": "./flow-state-dev"`,
   `claude plugin validate` reported success, and `claude plugin install` failed with
   `Source path does not exist: …/marketplace/flow-state-dev`. Writing the full relative
   source (`./plugins/flow-state-dev`) fixed it. **A green validator is not evidence the
   plugin installs** — the goal check has to run the install, which is what the issue's
   review note 9 already asks for, and this is the concrete reason it was right to ask.

3. **Both steps are non-interactive `claude plugin …` subcommands**, not just slash
   commands, so the install-and-invoke goal check is scriptable rather than a manual
   ceremony. (`claude plugin eval` also exists and can score a skill against cases; not
   explored here.)

### Added on the re-shape run — brownfield ships through this plugin

The direction change made the install skill a packaged skill, which raised two questions
this POC could answer directly. `install-fsd/SKILL.md` was added and the round trip re-run.

4. **Skills are discovered from directories. Adding one edits no manifest.** Dropping
   `skills/install-fsd/SKILL.md` in took the inventory from one skill to two with **no
   change to `plugin.json` and no change to `marketplace.json`** — neither file lists its
   skills. So the fifth skill is a file drop, and FIX-1159 can land it without touching
   anything this issue owns. There is no manifest entry for the two issues to race on.

5. **A skill grounded in something other than `AGENTS.md` packages identically.**
   `install-fsd`'s first instruction runs `npx @flow-state-dev/cli init --report --json`
   rather than reading `AGENTS.md` — it is the thing that *creates* `AGENTS.md`. It loaded
   and listed exactly like the authoring skill beside it. The conflict between the install
   skill and "every packaged skill reads `AGENTS.md` first" is entirely a rule we wrote, not
   a constraint the tooling imposes.

6. **Every packaged skill costs always-on tokens in every consumer's session.**
   `claude plugin details` projects it per component:

   ```
   Projected token cost
     Always-on:   ~203 tok   added to every session
     component     always-on  on-invoke
     create-block       ~100       ~830
     install-fsd        ~100       ~460
   ```

   The always-on share is the frontmatter — the `description` is what makes a skill
   discoverable, so it is loaded whether or not the skill fires. Five skills is roughly
   500 always-on tokens in every session of every developer who installs the pack. That is
   the concrete price of the skill count, and it is a reason to keep the pack small that
   is stronger than taste.

## What it does not show

Nothing about installing from a **remote** source — this ran against a local path, and this
repository has no `.claude-plugin/` on `main` yet, so there was nothing remote to point at.
Whether a `github`-sourced install of a repo this size is acceptably fast is still untested.

One correction to how the spec described the escape hatch for that: **`plugin marketplace
add` takes `--sparse <paths...>`**, documented as "Limit checkout to specific directories
via git sparse-checkout (for monorepos)", with `--sparse .claude-plugin plugins` as its own
example. That is a real flag on the command a consumer types, not a source type in our
manifest. Read from `--help`; not exercised, because exercising it needs a published
manifest on a remote.

Both `SKILL.md` files here are **sketches of shape, not content**. `create-block` sketches
the consumer-facing rewrite of one of our authoring skills; `install-fsd` sketches the
packaging shape of a skill **whose real content FIX-1159 owns**. Judge how they ground
their facts, not their prose.
