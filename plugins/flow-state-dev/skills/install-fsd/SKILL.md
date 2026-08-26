---
name: install-fsd
description: Wire FSD into an existing Next.js App Router or Node project. Detects the host, writes only the files FSD needs, and prints what to run next.
---

# Install FSD

Add Flow State Dev to the project the developer already has. You read facts from the detection report. You do not guess them. You write only what the allowlist permits. You never commit.

## Run detection first

Never guess a fact the report carries. From the project directory:

```bash
node ${SKILL_DIR}/detect/detect.mjs . --json
```

Read stdout. Exit `1` means `refusals` is non-empty — **stop**. State each refusal in the developer's terms and print its `remediation`. Nothing is written. Exit `2` means the script was called wrongly; fix the invocation and run it again.

The report schema is `fsd-detect/1`. Fields you act on: `host`, `topology` (`host.topology`), `appRoot`, `packageManager`, `routeExtension`, `mount`, `routeSlots`, `devCommand`, `fsdevConfig`, `secrets`, `secretFiles`, `ignoreFile`, `instructionsFile`, `refusals`, `runtime`, `providerKeys`. If a field is missing, stop — do not invent it.

## State the shape

Say out loud which shape `host.topology` named:

- `mounted-route` — Next.js App Router. FSD answers inside their server at `mount.path`.
- `second-process` — plain Node. FSD runs beside their server.

If `host.topology` is `null`, the report already refused. You have already stopped.

## Allowlist

Files this run may write or append to, and no others. The count differs by host. Never write `package.json` or a lockfile — the package manager does.

### next (7)

- `fsdev.config.mts`
- `flows/hello/flow.mts`
- `<appRoot.path>/api/flows/route.<routeExtension.value>`
- `<appRoot.path>/api/flows/[...path]/route.<routeExtension.value>`
- `.gitignore`
- `.env.local`
- `AGENTS.md`

Both mount paths sit under `appRoot.path` and use `routeExtension.value`. Never create a root `app/` when `appRoot.path` is `src/app`.

### node (5)

- `fsdev.config.mts`
- `flows/hello/flow.mts`
- `.gitignore`
- `.env.local`
- `AGENTS.md`

Write `fsdev.config.mts` only when no `fsdev.config.*` of any extension exists (`fsdevConfig.winner` is empty). A user-owned config is not a collision: skip writing a config, write everything else, and hand back the one line that registers `./flows/hello/flow.mts` as kind `hello`.

---

## Phase 1 — Decide. Nothing is written in this phase, ever.

Every refusal is decided from state you have not modified. No refusal may originate in Phase 2.

1. **If `refusals` is non-empty: stop.** Print each `message` and `remediation`.
2. **If `runtime.meetsFloor` is false: stop.** The floor is `runtime.floor` (22.18).
3. **ASK which provider** — `openai`, `anthropic`, or `google`. No default. A refusal to answer is a refusal to proceed.
   **NEVER ask for, accept, echo or repeat the KEY ITSELF.** This is a chat transcript, not their terminal. If they paste a key anyway, do not write it, do not repeat it, and tell them it has been exposed and should be rotated. Continue with the empty-line-and-paste flow.
4. **PREFLIGHT every path on this host's allowlist.**
   - For a mount path, test the whole slot in `routeSlots` — every enabled extension, not just the one you picked.
   - absent → will write
   - ours (`fsd:generated` marker matches) → will rewrite
   - their `fsdev.config.*` → not a collision; skip writing a config
   - anything else of theirs → **refuse the whole run**, name every such path
5. **EVALUATE the credential question without touching anything.** Detection already asked git. If `secretFiles` names a file with `tracked: true`, the report refused. If a file would not be ignored after your `.gitignore` section, the report refused. Do not re-check by editing their tree.
6. **DECIDE what `.env.local` needs**, from `secrets` — never by printing a value.
   - Provider key (`providerKeys` row for the chosen provider):
     - `non-empty` anywhere → write nothing for that key
     - `empty` → leave that line; you will ask them to fill it
     - `absent` → you will append `KEY=` with an empty value
   - `FSD_DEMO_TOKEN` is generated. Write it to the destination `secretFiles` named for it (the write root's `.env.local` unless a file inside the write root already holds a non-empty value, in which case reuse and write nothing). **never print** the token, never echo it, never read it back into this conversation.
   - Never a second assignment for a key that already appears.
7. **State the plan:** one line per file, created or appended. Then wait for the developer to accept.

Provider mapping — the answer decides the package, the env var, and the model intent `default`. All three must agree:

| provider    | package installed     | env var                         | `defaultModel`            |
| ----------- | --------------------- | ------------------------------- | ------------------------- |
| `openai`    | `@ai-sdk/openai`      | `OPENAI_API_KEY`                | `openai/gpt-5.4-mini`     |
| `anthropic` | `@ai-sdk/anthropic`   | `ANTHROPIC_API_KEY`             | `anthropic/claude-sonnet-4-6` |
| `google`    | `@ai-sdk/google`      | `GOOGLE_GENERATIVE_AI_API_KEY`  | `google/gemini-2.5-flash` |

Copy the templates in `${SKILL_DIR}/templates/` and substitute. The wiring shape is `${SKILL_DIR}/wiring-contract.md`.

---

## Phase 2 — Write. No refusal may originate here.

Write only what Phase 1 decided. Additive: never overwrite a file this run did not author. A file with a missing or stale `fsd:generated` marker is theirs — leave it, name it, and print what would have changed.

### Authored-whole files

Copy the matching template. Compute `sha256` of the body below the marker line and write `// fsd:generated sha256:<hex>` as the first line.

- `fsdev.config.mts` — only when no `fsdev.config.*` exists. Substitute the provider import, `providers: { <name> }`, `defaultModel`, and `intents.chat`. Register `./flows/hello/flow.mts` as `hello`.
- `flows/hello/flow.mts`
- Next only: the mount pair under `appRoot.path` with `routeExtension.value`. Substitute `{{CONFIG_IMPORT}}` with the relative path from that file to the write-root `fsdev.config.mts`.

### Appended files

One delimited section, created when the file is absent, appended when it is present, replaced between our own delimiters on a second run. Never read or rewrite anything outside the delimiters.

`.gitignore` — hash delimiters (`# flow-state-dev:start` / `# flow-state-dev:end`). The section lists `.env.local` and `.fsdev/`.

`AGENTS.md` — markdown delimiters. The section is a placeholder FIX-1160 substitutes at packaging. Write exactly this and nothing else between the delimiters. Never restate its content.

```
<!-- flow-state-dev:start -->
{{AGENT_INSTRUCTIONS}}
<!-- flow-state-dev:end -->
```

`.env.local` is **not** on the delimited-section list. Follow the Phase 1 decision.

**Generate `FSD_DEMO_TOKEN` without ever printing it.** Run this with `DEST` set to the path `secretFiles` named, and only when Phase 1 decided you will write it:

```bash
node --input-type=module -e '
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
const dest = process.argv[1];
const existing = existsSync(dest) ? readFileSync(dest, "utf8") : "";
if (/(?:^|\n)FSD_DEMO_TOKEN=/.test(existing)) {
  console.log("FSD_DEMO_TOKEN already has a line; left it alone.");
  process.exit(0);
}
const token = randomBytes(32).toString("hex");
appendFileSync(dest, (existing.endsWith("\n") || existing.length === 0 ? "" : "\n") + "FSD_DEMO_TOKEN=" + token + "\n");
console.log("Wrote FSD_DEMO_TOKEN to the destination file.");
' -- "$DEST"
```

The script prints a confirmation. It does not print the token. Do not `cat`, `echo`, or open that file afterwards.

If the provider variable is absent, append `KEY=` with an empty value (the name from the table). Ask the developer to paste the key into that line themselves. Then assert only that the variable is present and non-empty — a fact about the file, established without reading the secret back. If it is still empty, stop before install. Do not print next steps that promise a model response the project cannot produce.

### Install

Through the reported `packageManager` (`npm` / `pnpm` / `yarn`). Never write a lockfile yourself.

Runtime: `zod`, the chosen `@ai-sdk/*`, `@flow-state-dev/core`, `@flow-state-dev/engine`, and for `next` also `@flow-state-dev/next`.
Dev: `@flow-state-dev/fsdev`, `@flow-state-dev/devtool`.

Every package a generated file imports directly is a direct dependency. `pnpm add` / `npm install` / `yarn add`, then `-D` for the two dev packages.

If the install fails, files stay. Report the exact command to retry. Do not roll back.

### Verify, then print next steps

Run every command you are about to print, then emit the block below. Embed it verbatim. Fill the placeholders from the report (`packageManager` → `{{run}}` / `{{exec}}` / `{{execSep}}`; `devCommand` → `{{devScript}}` / `{{devUrl}}`; `mount.path` → `{{mountPath}}`). Render only the branch that matches `host.topology`. Never invent `pnpm dev` or `localhost:3000`.

<!-- next-steps:canonical -->
Next steps

{{#mounted-route}}
  {{run}}{{runSep}} {{devScript}}
      your app, now serving FSD at {{mountPath}}
      → {{devUrl}}

  {{exec}}{{execSep}} fsdev dev --port {{devPort}}
      the FSD DevTool, in a second process
      → http://localhost:{{devPort}}

  {{exec}}{{execSep}} fsdev run hello send --input '{"userId":"u1","message":"hi"}'
      run the demo flow from your terminal
{{/mounted-route}}
{{#second-process}}
  {{exec}}{{execSep}} fsdev dev --port {{devPort}}
      the FSD API and the DevTool, in one process beside your own server
      → http://localhost:{{devPort}}

  {{exec}}{{execSep}} fsdev serve --host 127.0.0.1 --port {{servePort}}
      the same API without the DevTool
      → http://127.0.0.1:{{servePort}}
      Keep the --host 127.0.0.1. It binds the listener to loopback, so nothing
      off this machine can reach it.

  {{exec}}{{execSep}} fsdev run hello send --input '{"userId":"u1","message":"hi"}'
      run the demo flow from your terminal

  Your own server is untouched and starts exactly the way it did before.
{{/second-process}}

Worth knowing before you build on this

  The ports above are defaults, picked to be unlikely to clash with what you
  already run. Nothing here can know they are free. If one is taken, pass a
  different --port.

  The demo flow is closed over HTTP. A request to it has to carry
  Authorization: Bearer $FSD_DEMO_TOKEN, and that value is in .env.local.
  A request without it is refused, and no model call is made. Only the demo
  flow is affected — everything else this project serves is unchanged.

  fsdev run never authenticates. It executes in-process as a local, trusted
  path and does not look at the token at all, which is why the command above
  works without one. That is what the CLI does, not a gap in the HTTP route.

  Sessions are kept on disk by the development file store. It expects one
  process at a time: two FSD servers over the same data directory can each
  accept the same write, so do not drive one session from both at once.

  A shared secret is not authentication, and a development file store is not
  a database. Replace both before this project serves anyone but you.

  AGENTS.md now tells your coding assistant how to write FSD flows here.
<!-- /next-steps:canonical -->

Name every file you touched, including the lockfile the package manager wrote. Leave the working tree dirty — the developer reviews the diff.

A developer without a coding assistant is not served by this skill. Point them at https://flow-state.dev/docs/getting-started/existing-project.
