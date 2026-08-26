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

The report schema is `fsd-detect/1`. Fields you act on: `host`, `topology` (`host.topology`), `appRoot`, `packageManager`, `routeExtension`, `mount`, `routeSlots`, `devCommand`, `devCommand.needsSeparator`, `fsdevConfig`, `fsdevConfig.winner`, `fsdevConfig.winnerIsOurs`, `secrets`, `secretFiles`, `ignoreFile`, `instructionsFile`, `refusals`, `runtime`, `providerKeys`. If a field is missing, stop — do not invent it.

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

Write `fsdev.config.mts` only when no `fsdev.config.*` of any extension exists (`fsdevConfig.winner` is empty). A user-owned config is not a collision: skip writing a config, write everything else, and hand back the one line that registers `./flows/hello/flow.mts` as kind `hello`. A config whose `fsdevConfig.winnerIsOurs` is true already registers that flow — skip writing it and do **not** print the registration line.

---

## Phase 1 — Decide. Nothing is written in this phase, ever.

Every refusal is decided from state you have not modified. No refusal may originate in Phase 2.

1. **If `refusals` is non-empty: stop.** Print each `message` and `remediation`.
2. **If `runtime.meetsFloor` is false: stop.** The floor is `runtime.floor` (22.18).
3. **ASK which provider** — `openai`, `anthropic`, or `google`. No default. A refusal to answer is a refusal to proceed.
   **NEVER ask for, accept, echo or repeat the KEY ITSELF.** This is a chat transcript, not their terminal. If they paste a key anyway, do not write it, do not repeat it, and tell them it has been exposed and should be rotated. Continue with the empty-line-and-paste flow.
   Then re-run detection with that provider's env var so `secretFiles` includes their key:

   ```bash
   node ${SKILL_DIR}/detect/detect.mjs . --json --provider OPENAI_API_KEY
   ```

   Use `ANTHROPIC_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` when they chose that provider. Exit `1` here is a new refusal — **stop**. Read this report from here on.
4. **PREFLIGHT every path on this host's allowlist.**
   - For a mount path, test the whole slot in `routeSlots` — every enabled extension, not just the one you picked.
   - absent → will write
   - ours (`fsd:generated` marker matches) → will rewrite
   - their `fsdev.config.*` → not a collision; skip writing a config
   - anything else of theirs → **refuse the whole run**, name every such path
5. **EVALUATE the credential question without touching anything.** Detection already asked git. If `secretFiles` names a file with `tracked: true`, the report refused. If a destination has `ignored: false` and the planned `.gitignore` section (`.env.local` and `.fsdev/`) would not cover that path, **stop** — do not write a secret git would commit. Do not re-check by editing their tree.
6. **DECIDE what each `secretFiles` destination needs**, from `secrets` and the `reasons` on that file — never by printing a value.
   - Provider key (`secrets` row for the chosen env var):
     - `non-empty` anywhere → write nothing for that key
     - `empty` → leave that line; you will ask them to fill it
     - `absent` → you will append `KEY=` with an empty value on the destination named for that key
   - `FSD_DEMO_TOKEN` is generated. Act on **every** `secretFiles` entry whose `reasons` name it:
     - reason says the value will be reused → write nothing there
     - reason says an empty assignment is the line a runtime resolves → fill that existing line
     - reason says it will be generated here → append one assignment
   - Never a second assignment for a key that already appears. **Never print** the token, never echo it, never read it back into this conversation.
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
- Next only: the mount pair under `appRoot.path` with `routeExtension.value`. Substitute `{{CONFIG_IMPORT}}` with the relative path from that file to `fsdevConfig.winner` when a winner exists, otherwise to the write-root `fsdev.config.mts` this run is authoring.

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

**Generate `FSD_DEMO_TOKEN` without ever printing it.** Pass every destination Phase 1 decided you will write or fill. One token is generated and reused across those files. A destination whose reason said reuse is not in this list.

```bash
node --input-type=module -e '
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
const dests = process.argv
  .slice(process.argv.includes("--") ? process.argv.indexOf("--") + 1 : 1)
  .filter((p) => p !== "[eval]");
const token = randomBytes(32).toString("hex");
for (const dest of dests) {
  const existing = existsSync(dest) ? readFileSync(dest, "utf8") : "";
  if (/(?:^|\n)FSD_DEMO_TOKEN=[^\r\n]+/.test(existing)) {
    console.log("FSD_DEMO_TOKEN already has a value in one destination; left that file alone.");
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  if (/(?:^|\n)FSD_DEMO_TOKEN=(?:\r?\n|$)/.test(existing) || /(?:^|\n)FSD_DEMO_TOKEN=\r?$/.test(existing)) {
    writeFileSync(dest, existing.replace(/(^|\n)FSD_DEMO_TOKEN=(?=\r?\n|$)/, "$1FSD_DEMO_TOKEN=" + token));
    console.log("Filled an empty FSD_DEMO_TOKEN line.");
    continue;
  }
  writeFileSync(dest, existing + (existing.endsWith("\n") || existing.length === 0 ? "" : "\n") + "FSD_DEMO_TOKEN=" + token + "\n");
  console.log("Wrote FSD_DEMO_TOKEN to a destination file.");
}
' -- $DESTS
```

The script prints confirmations. It does not print the token. Do not `cat`, `echo`, or open those files afterwards.

If the provider variable is absent, append `KEY=` with an empty value (the name from the table). Ask the developer to paste the key into that line themselves. Then assert only that the variable is present and non-empty — a fact about the file, established without reading the secret back. If it is still empty, stop before install. Do not print next steps that promise a model response the project cannot produce.

### Install

Through the reported `packageManager` (`npm` / `pnpm` / `yarn`). Never write a lockfile yourself.

Runtime: `zod`, the chosen `@ai-sdk/*`, `@flow-state-dev/core`, `@flow-state-dev/engine`, and for `next` also `@flow-state-dev/next`.
Dev: `@flow-state-dev/fsdev`, `@flow-state-dev/devtool`.

Every package a generated file imports directly is a direct dependency. `pnpm add` / `npm install` / `yarn add`, then `-D` for the two dev packages.

If the install fails, files stay. Report the exact command to retry. Do not roll back.

### Verify, then print next steps

Save the latest detection report to a temp file (it carries no secret values). After the packages are installed, render the block with the function that owns the substitutions — do not fill placeholders by hand, and never invent `pnpm dev` or `localhost:3000`:

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { renderNextSteps } from "@flow-state-dev/fsdev";
const report = JSON.parse(readFileSync(process.argv[1], "utf8"));
process.stdout.write(renderNextSteps({
  topology: report.host.topology,
  packageManager: report.packageManager.value,
  devScript: report.devCommand.script ?? undefined,
  devUrl: report.devCommand.url ?? undefined,
  mountPath: report.mount.path ?? undefined,
}) + "\n");
' -- "$REPORT_JSON"
```

Run every command that output printed. The source you embed in this skill (below) is what `renderNextSteps` starts from. Keep it, so the exported comparison can still prove this copy has not drifted.

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
