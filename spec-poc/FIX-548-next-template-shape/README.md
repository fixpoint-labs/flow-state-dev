# POC — what shape does the Next.js template actually have to be?

Throwaway. Lives on the spec branch, never merges, CI ignores `spec-poc/`.

FIX-548's template has to satisfy two consumers of the same config file at once: the **Next.js
bundler** (the mounted route imports it) and the **`fsdev` CLI** (a native `import()` loads it).
FIX-1159 decision 4 settles the CLI half by using `.mts`. Nobody had checked the bundler half,
and the whole product — a streamed response rendered in a browser — runs through it.

**Precondition: Node 22.18 or newer.** Native TypeScript type stripping arrives in 22.18, and
every variant here loads a TypeScript config through a native `import()`. On 22.0–22.17 those
imports cannot produce the clean result the table documents, so the script reports mismatches and
**exits 1 — which on that runtime means nothing at all.** Read a run on older Node as *not
performed*, never as a claim disproved. This is a stated precondition rather than a check inside
the script, because the script is frozen (below) and a closed artifact with a documented
requirement is smaller and more honest than one that keeps growing environment handling. The
failure is also loud rather than subtle: every variant mismatches at once, which reads as a
broken environment, not as a finding.

Run it: `bash probe.sh [workdir]` (needs network; ~3 minutes). It scaffolds a real
`create-next-app@16.3.1` project, drops each candidate config shape in, and runs `next build`,
`next dev`, and a native `import()` against each. It refuses to run if `<workdir>/probe` already
exists rather than deleting it.

## The contract between this file and the script

**Every claim in this file is backed by an assertion that fails the run if the claim becomes
false — except the ones in *What this POC does not establish*, which is the list of facts the
spec cites and this script deliberately does not back.** Those two sections are exhaustive:
asserted, or named as unasserted. Nothing sits between them.

That is the point of the file, and it has been the source of every review finding against this
POC — rounds of "this check cannot fail the thing it is cited for," including one against an
earlier version of this very contract, which claimed everything below it was asserted while an
externally-sourced fact sat in the asserted list.

### `probe.sh` is frozen. The README is the only moving part.

**Do not edit `probe.sh` again** — not for a finding, not for a cleanup, whoever you are. The
design question this POC existed to answer was settled three rounds ago; every round since has
been about the script's evidence quality, on a throwaway attached to a PR that never merges.

So the rule from here: **any further finding is answered by narrowing a claim in this README to
what the frozen script actually proves — never by changing the script.** Move the claim into
*What this POC does not establish*, or delete it.

The reasoning, not just the rule: a probe that keeps earning review rounds is a probe asserting
more than its job requires. The cheapest way to end that loop is to stop claiming so much, which
is the same move that closed round 3 — and unlike growing the script, it cannot introduce a new
check that fails for its own reasons.

**The freeze was lifted once, deliberately, and this is the record of it.** A review found that
`git init` discarded its exit status before the `.gitignore` check, so a machine where git is
missing or init fails would fall through to `fail` and report **exit 1 — the ignore claim
disproved** — when the truth was that it could not be tested. The scaffold runs with
`--disable-git`, so that environment is independently reachable.

That was fixed in the script rather than narrowed in this README, and the distinction is the
reason the rule survives intact:

- **The rule covers over-assertion.** A probe claiming more than it proves is answered by moving
  the claim into *What this POC does not establish*. Every round the freeze was written for was
  that shape.
- **This was under-reporting, in the one direction that cannot be documented away.** Narrowing the
  README here would mean writing "if the ignore check exits 1, it might instead mean git failed" —
  which does not remove the false disproof, it teaches the reader to distrust exit 1 *everywhere*
  in this script. A red result nobody believes is worse than no check.
- **The fix added no assertion surface.** It routes one already-existing failure mode into the
  `2` the script already uses in ten other places. It closes a gap in this contract rather than
  extending it.

**The freeze is back on**, unchanged, with one clause added by the case: a finding that the script
reports a *true* claim as **disproved** is fixed in the script; everything else is narrowed here.

**That clause has since fired a second time, which is the point of writing it down.** The native
`import()` check reads stderr to decide whether Node's documented
`MODULE_TYPELESS_PACKAGE_JSON` warning appeared — and Node's warning suppression is inherited from
the environment. With `NODE_NO_WARNINGS=1` or `--no-warnings` in `NODE_OPTIONS`, the
no-`type`-field variant emits nothing, classifies as `clean`, and the probe exits **1: claim
disproved**, when the environment had merely hidden the evidence. Same direction as the `git init`
case, different cause. Fixed in the script — both variables are cleared for that invocation — and
**not re-argued**, because the rule already decided it: this is under-reporting, not
over-assertion, and documenting it would again mean telling a reader that a red result might not
mean what it says.

*Two instances is enough to state the underlying shape:* **this probe's evidence is read from
process output, and process output is environment-dependent.** Any future check that decides a
claim by looking at stdout/stderr inherits the same failure mode, so it clears whatever suppresses
the signal it reads, or classifies the environment as cannot-verify (`2`).

Exit status: `0` every asserted claim held · `1` one of them did not · `2` the run could not be
completed (scaffold or install failed, no free port, workdir occupied, dev server never bound, a
request that never completed). The `1`/`2` split is load-bearing: a machine too slow to have
bound the port, or a request that died in transport, is not a disproved claim. The script polls
for the bind against a deadline instead of sleeping a fixed interval, and checks `curl`'s exit
status before comparing any body, so neither can be reported as the other.

"Clean" in the table below means **nothing on stdout or stderr**, asserted as an empty log rather
than as the absence of the one warning we expected — otherwise a new loader or deprecation
warning would be silently classified clean.

Each variant asserts both its **outcome** and its **diagnostic**, so "the build failed" is not
automatically a pass for a row documented as failing — a route-file typo, a dependency problem,
or a future Next regression would otherwise be read as "matched the documented result". Rows
documented as passing assert the route actually compiled (`/api/flows` in the build output),
not merely that the process exited 0.

**What this POC does not establish** — stated because the spec cites it and the boundary matters:

- **That `force-dynamic` prevents response buffering.** It needs a real streamed model response
  to observe. §10's goal check owns it, by requiring the response to render *incrementally*.
- **That `--agents-md` is on by default.** The invocation passes it explicitly, as the spec
  requires of every flag, so nothing here speaks to the default. What is asserted is that
  `create-next-app` still writes `AGENTS.md` **when asked** — which is what the design rests on.
- **That `next dev` re-creates a missing `AGENTS.md` block.** Next's block is present before the
  server starts, so the check proves it was left alone, not that it would be restored. (Next's
  own block says it re-adds itself; nothing here tests that, and nothing in the design needs it.)
- **That `create-next-app` fills unprovided options from saved preferences.** It prints `Using
  defaults for unprovided options`, and its `--help` documents the behaviour — this is why the
  spec requires every flag to be passed explicitly and rules out `--yes`: an option we leave off
  can resolve differently on a machine that has run the tool before. **The script passes every
  flag, so it never reproduces this and cannot fail on it.** Establishing it would need a second
  scaffold run with an option deliberately withheld, which buys a fact the spec already acts on
  at the cost of doubling the probe's slowest step. Stated here, outside the asserted list,
  rather than dropped, because the spec cites it for the bare-app step's flag discipline.
- **Any import form for a config that imports *another module*.** The config this script drops in
  is **self-contained** — it imports nothing. The real `fsdev.config.ts` imports the demo flow,
  and that is a second resolution question this probe never asked: Turbopack infers a missing
  extension, native Node does not. So every row above speaks to the config's *own* extension and
  nothing else. Settled separately, by execution, and recorded in the spec's decision 4: the
  relative specifier must carry `.ts` and the generated `tsconfig.json` must set
  `allowImportingTsExtensions`. **This is the gap that mattered most** — the probe passed while
  the shape the template actually ships had no working import form at all.
- **Whether a provider SDK that `@flow-state-dev/core` imports dynamically by package name
  resolves inside the Next.js server bundle.** `createModelResolver` carries a `directLoadFailed`
  fallback for exactly this case, so it is a known hazard. Only a real run with a real key
  reaches it — §10's goal check does, through the mounted route rather than through `fsdev run`.

## What it settled

| Variant | `next build` | native `import()` | verdict |
|---|---|---|---|
| `fsdev.config.mts`, imported as `../fsdev.config.mts` | fails — `TS5097: An import path can only end with a '.mts' extension when 'allowImportingTsExtensions' is enabled` | clean | needs a `tsconfig.json` edit |
| `fsdev.config.mts`, imported as `../fsdev.config` | fails — `Module not found`; Turbopack does not resolve extensionless to `.mts` | clean | dead |
| `fsdev.config.mts`, with `allowImportingTsExtensions: true` added to the tsconfig | passes | clean | works, at the cost of both edits this row names |
| **`fsdev.config.ts` + `"type": "module"` in the manifest** | **passes** | **clean, no warning** | **chosen (§6 decision 4)** |
| `fsdev.config.ts`, no `type` field | passes | loads, but emits `MODULE_TYPELESS_PACKAGE_JSON` | rejected |

The chosen variant is also run end to end against the shape the spec specifies — both route
files, with the canonical `runtime = "nodejs"` and `dynamic = "force-dynamic"` exports. `next dev`
serves `GET /api/flows` (the bare route) and `GET /api/flows/sessions/abc` (the catch-all), and
each returns this run's unique marker, proving the config module that answered is the one this
run wrote rather than a stale server.

## What it found that nothing in the epic or the sibling specs knew

Asserted **before the script writes anything**, because the checks are otherwise self-concealing:
the script later appends its own section to `AGENTS.md`, so a check at the end would go green
exactly when the pinned scaffolder had stopped producing these files.

1. **`create-next-app@16.3.1` writes `AGENTS.md`**, carrying its own delimited block
   (`<!-- BEGIN:nextjs-agent-rules -->`). So the greenfield Next path is an **append to an
   existing file, never a create** — the case everyone had filed as brownfield-only. Our appended
   FSD section is still intact after a `next dev` run, and so is Next's block: both are captured
   whole before the server starts and compared byte-for-byte afterwards, plus an occurrence count
   that a comparison alone cannot see a duplicate through. A marker count on its own would pass
   on a section truncated after its sentinel.
2. **It also writes `CLAUDE.md`.**
3. **Git ignores `.env.local` in a fresh scaffold.** Asserted with `git check-ignore`, not by
   grepping `.gitignore` — a text match on `^\.env` also passes for a file that only lists
   `.env.example`, which would leave `.env.local` publishable. The credential stop (spec
   decision 7) rests on this, so it is checked the way the real command has to check it: ask git
   about the path, before the key is written.
