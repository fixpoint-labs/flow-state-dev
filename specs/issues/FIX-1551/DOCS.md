# FIX-1551 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Written to F1 and F2 as the owner answered them. Implementation reconciles
this against the shipped messages, then runs it through `docs-writer` and `docs-editor` before
publishing.

## UPDATE · `apps/docs/docs/cli/configuration.md` · new section after "What the CLI uses (and overrides)"

### Who a run is

Every run executes as a user in an organization, the same as a request to your server. When a
config loads, the CLI asks your app who it is, the same way your server asks for every request:
through your `resolvePrincipal`, the flow's own if it has one, otherwise the one you passed to
`createFlowState`. Whatever that returns is who the run is.

The CLI's question carries no request and no credential. Your resolver sees `source: "cli"`.
The framework reserves that value for `fsdev run` and `fsdev chat`: a transport adapter that
stamps it, including one you wrote, is refused before your resolver runs. So a resolver that
wants the terminal to get a particular identity can check for it:

```ts title="fsdev.config.ts"
resolvePrincipal: async (ctx) =>
  ctx.source === "cli"
    ? { userId: "local-dev", orgId: "acme" }
    : readSession(ctx.request),
```

An app with no resolver runs as `cli-user` in the development organization, `DEFAULT_ORG_ID`.

**When the resolver wants a credential.** A resolver that checks a bearer token or a signature
has nothing to check, so it refuses, and the run stops before it writes anything. The error names
the flow. Pass `--org` to say which organization to run in yourself:

```bash
fsdev run billing refund -i '{"id":"r_1"}' --org acme --user support-bot
```

`--org` skips your resolver entirely. It is for the person at the keyboard, who already holds the
store credentials the CLI is using. `fsdev serve` and `fsdev dev` have no such flag: requests that
arrive over the network always go through your resolver. `--user` on its own keeps the
organization your resolver gives and changes only the user.

Sessions keep the organization they were created in. Resuming one with `--session` under a
different organization is refused, the same as it would be over HTTP.

`--capture` records who the run was, under `command.principal`, including whether your resolver,
a flag, or the development default decided it.

## UPDATE · `apps/docs/docs/api/cli.md` · `fsdev run` options table

Add two rows after `-s, --session <id>`:

| Flag | Description |
|------|-------------|
| `--org <id>` | Run in this organization instead of asking the app's resolver. Local only; see [Who a run is](/docs/cli/configuration#who-a-run-is) |
| `-u, --user <id>` | Run as this user. Without `--org`, the app's resolver still decides the organization |

Add after the options paragraph: "Without `--org`, the run is whoever your app's resolver says it
is. See [Who a run is](/docs/cli/configuration#who-a-run-is)."

## UPDATE · `apps/docs/docs/api/cli.md` · `fsdev chat` options table

Add after `-u, --user <id>`, and change that row's description:

| Flag | Description |
|------|-------------|
| `-u, --user <id>` | Run turns as this user. Default: the app's resolver's user, or `cli-user` with no resolver |
| `--org <id>` | Run turns in this organization instead of asking the app's resolver |

## UPDATE · `apps/docs/docs/cli/interactive-chat.md` · the paragraph on `cli-user` and `devuser`

Replace it with:

Turns run as whoever your app's resolver says, asked once per turn for that turn's flow. With no
resolver, that is `cli-user`, while the DevTool defaults to `devuser`. To see a chat session in
the DevTool's session list, or resume one across the two, align them with `--user devuser`. A turn
whose flow refuses the terminal fails on its own; the session carries on. `/status` shows the
organization.

## UPDATE · `apps/docs/docs/server/authentication.md` · "Host-level fallback", after the per-flow sentence

`fsdev run` and `fsdev chat` ask the same resolvers, with `source: "cli"` and no request. See
[Who a run is](/docs/cli/configuration#who-a-run-is).

## UPDATE · `packages/cli/README.md`

- `fsdev run` → options: add `--org` and `--user` as above.
- Capture mode → the example gains `"principal": { "userId": "...", "orgId": "...", "from": "resolver" }`
  inside `command`.
- `fsdev chat` → options: add `--org`; reword `--user` as above.

## UPDATE · `packages/engine/README.md` · FlowState section

One line for S1 under its shipped name: a loaded FlowState answers who an in-process caller is,
through the same resolvers and organization rules as its HTTP routes.

## UPDATE · `apps/kitchen-sink/README.md` · the `workforce-admin` note and mara's section

- The line explaining "Over HTTP rather than through `fsdev run`" becomes: over HTTP, because the
  admin flow checks a token and the CLI carries none.
- Mara's "out of the box, mara can't hire" paragraph is FIX-1500 PR-B's to rewrite. If PR-B has
  landed first, add: "`pnpm fsdev run support.mara …` hires too; the CLI runs as the same
  `devuser` in `kitchen-sink`."

## UPDATE · `docs/architecture/inbound-transports.md` · the `source` paragraph under "The envelope"

Add after the known-set sentence: `cli` is reserved. Only the engine's in-process entry point
produces it, for `fsdev run` and `fsdev chat`; the host refuses `source: "cli"` from any
adapter, whatever source that adapter declares.

## Publication ownership

FIX-1551 owns every operation above. The kitchen-sink mara paragraph is shared with FIX-1500
PR-B; whichever lands second reconciles it.
