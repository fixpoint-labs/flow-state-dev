# POC — can this repo ship an installable Claude plugin?

Throwaway. Lives on the never-merged spec branch for **FIX-1160**. Nothing here ships.

## The premise it checks

The epic recorded that FSD has **no packaging or publishing path for skills today** — no
`.claude-plugin/`, no marketplace manifest — and then scoped FIX-1160's plugin to
**install-by-URL only**. The whole plugin half of the spec rests on a premise nobody had
run: *that a marketplace manifest hosted in this repository produces a plugin a stranger
can actually install, and that its packaged skills load.*

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

## What it showed (Claude Code v2.1.233)

**The premise holds.** A `.claude-plugin/marketplace.json` plus a plugin directory with its
own `.claude-plugin/plugin.json` and a `skills/<name>/SKILL.md` installs and exposes the
skill:

```
Component inventory
  Skills (1)  create-block
```

Three things worth carrying into the build:

1. **"Install by URL" means adding a *marketplace*.** There is no command that installs a
   bare plugin from a URL — the path is always `plugin marketplace add <source>` then
   `plugin install <plugin>@<marketplace>`. So shipping a marketplace manifest is not the
   same as taking a public listing, and it does not contradict the epic's decision. The
   distribution artifact is required; the directory listing is the thing we are declining.

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

## What it does not show

Nothing about installing from a **remote** source — this ran against a local path. Whether
a `github`-sourced install of a repo this size is acceptably fast is untested, and is the
one packaging question left for implementation.

The `create-block/SKILL.md` here is a **sketch of the consumer-facing rewrite**, included
so the round trip had something real to load. Judge its shape (facts deferred to
`AGENTS.md`, verification through the CLI), not its prose.
