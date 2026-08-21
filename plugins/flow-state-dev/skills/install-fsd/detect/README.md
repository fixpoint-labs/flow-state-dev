# FSD detection

Cheap, checkable facts about a repository, produced before anything is written to it.

```bash
node detect.mjs [directory] [--json | --prose] [--provider OPENAI_API_KEY]
```

- `0` — nothing refuses; the report is safe to act on
- `1` — at least one refusal fired. The report is still on stdout and names each one with its remediation
- `2` — the script was called wrongly

## What this is for

Adding FSD to a project someone already has is a reading problem before it is a writing problem, and a coding assistant guessing at these facts is the failure this exists to prevent. So they are derived deterministically and handed over as a report the assistant reads and does not overrule.

Two things follow from that, and they are the whole design.

**Nothing here writes.** Every refusal is decided from state the run has not modified, and nothing is written until every refusal condition has been evaluated and none fired. A detector that *cannot* write is a detector that cannot break that rule.

**Every fact is somebody else's resolution, not a look at the filesystem.** Which config the CLI loads is a precedence list, not a filename. Which files occupy a route slot is a matcher's extension set, not the name we picked. What a credential resolves to is a walk with two tie-breaks running in opposite directions, per runtime. Writing any of them down as a directly-observable property is how a report comes to describe something that does not run.

## The resolutions, in order

Each depends on the ones above it, and no later rule re-derives an earlier one from the filesystem.

| # | resolved fact | whose behaviour defines it |
|---|---|---|
| 1 | workspace root | the package manager's workspace discovery — the **outermost** declaration, else the repository. A lockfile is not a marker |
| 2 | write root | the manifest that declared the host. The only directory anything is ever written in |
| 3 | package manager | one precedence pass over the whole chain 2→1. Any `packageManager` field beats every lockfile, anywhere |
| 4 | app root | Next's `findDir` — `app/` before `src/app/` |
| 4b | the `next.config.*` Next loads | `findUp`, walking upward; `.js` → `.mjs` → `.ts` → `.mts` |
| 5 | route extension | Next's file matcher, from `pageExtensions` in 4b |
| 6 | mount URL | Next's router, from `basePath` in 4b |
| 7 | route slot occupancy | the same matcher, over a scan set wider than what is enabled |
| 8 | the `fsdev.config.*` the CLI loads | the CLI's own first-present-of-four search |
| 8b | registered flow kinds | the registry in 8, plus what each entry's import resolves to |
| 9 | each secret's effective status | per runtime, over that runtime's full precedence chain |
| 10 | the files that will hold a secret | 9's answers, narrowed by the chosen provider. A **set** — often two different files |

## No secret value leaves this directory

For every secret the run touches — a provider key the developer already had, the demo token, any credential in any file resolution 9 reads — the report carries `absent` / `empty` / `non-empty` and the path that decided it. Never the value, never a prefix, never a fingerprint.

The report is JSON an assistant reads, so anything in it is in a retained transcript. That is the same hazard the run refuses to create by asking for a key, and it covers the credential we did not author just as much as the one we do.

## Why these rules are shaped this way

Each of these was a defect first. They are recorded here rather than in the module headers, because a rule is easier to follow than a history — but a future edit that "simplifies" one of them would re-introduce a specific failure, so the failures are written down.

**Every refusal is decided from unmodified state.** Three separate defects were the same violation: an unsupported host, a colliding path, and an ignore rule read back *after* we had already edited the file. Each was fixed individually, which is how the next one gets written. A component with no way to write cannot make the mistake a fourth time.

**No fact is read off the directory.** Ten findings across four review rounds were the same mistake — a fact written down as a directly-observable property when it is really the output of somebody else's resolution algorithm — and each fix introduced the next instance because it was written in the same idiom.

**The scan set for a route slot is wider than what the project enables.** Run one writes `route.ts` under Next's defaults; the developer later narrows `pageExtensions` to `['tsx']`; a scan of enabled extensions alone then finds nothing, reports the slot empty, and writes a second handler beside the stale one — while the refusal that exists for exactly that state can never fire, because nothing looks where the stale file is.

**The workspace search is bounded twice.** Not by the nearest package-manager signal — a stale `package-lock.json` beside an app made that app its own workspace root and resolved npm inside a pnpm workspace. And not past the repository — a project nested inside an unrelated checkout inherited that repository's workspace declaration and resolved a package manager belonging to a project the developer has nothing to do with.

**There are two env parsers, not one.** The module modelled two runtimes with opposite tie-breaks and then parsed both with a single function that faithfully mirrored neither. Three findings lived in that one parser: `@next/env` performs variable expansion and we do not, `export KEY=…` is valid dotenv syntax and our CLI's parser is not, and destination selection consulted only one of the pair — so on a mounted-route host the file Next actually decides from never reached the tracked-by-git check.

**The source walker is anchored, and it is one walker.** It existed twice, and both copies took the first textual match: a commented-out `// basePath: '/old'` decided the mount URL, and a helper `const example = { flows: {} }` above the real call reported a live registry as free.

**`process.features.typescript` is a string.** Node reports `"strip"` or `"transform"`, never `true` — so a `=== true` check dropped `next.config.mts` from the candidate list on exactly the machines where Next accepts it. Both of that check's tests passed the value explicitly, so the default was never exercised.

## Running this from the monorepo

These files ship inside a plugin and run on somebody else's machine, so they import nothing from this repository and have no dependencies. A handful of constants are therefore duplicates of framework values; `test/twins.test.mjs` parses each one out of the real source and fails if the two disagree.
