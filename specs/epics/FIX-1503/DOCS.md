# FIX-1503 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

## UPDATE · `apps/docs/docs/server/authentication.md` · opening

Flow State Dev keys sessions and listings off a **principal**: the caller identity the
runtime trusts after the host has verified them. The framework does not run login, store
passwords, or act as an identity provider. The host owns sign-in. The framework accepts
only principals it can verify, and exposes one controlled way to turn host-owned proof
into a credential.

On a reachable deployment, every `/api/flows` route expects that credential except the
**identity mint**. After mint, clients send `Authorization: Bearer <jwt>`. Organization
scope still comes from the verified principal, not from fields the client writes in the
body.

Local development may opt into the older body-`userId` resolver explicitly. That mode is
not the shipped default. `@flow-state-dev/node` refuses to bind it to a network interface.

## CREATE · `apps/docs/docs/server/identity-mint.md`

The identity mint is a host-authenticated exchange. The host has already authenticated a
browser session or a machine credential. It then calls mint with a host service secret,
or a host-signed assertion, carrying the `userId` and organization the host alone may
assert. The framework signs a short-lived JWT. Clients present that JWT on `/api/flows`.

Machine callers follow the same shape: prove the machine to the host, mint once, then
use the JWT instead of putting a long-lived secret on every request.

**Limits.** End users do not call mint with raw OAuth codes. Expired tokens are 401; the
host mints again. A principal without a valid organization is refused. Tokens default to
fifteen minutes.

Place the page in Core → Engine, immediately after `server/authentication`, sidebar
label `Identity mint`.

## CREATE · `apps/docs/guides/host-identity-and-mint.md`

A host that already has login walks through: verify the session in middleware, call mint,
attach Bearer on `FlowProvider` / the client. Start-here sidebar, after `nextjs-setup`.

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| Shared opening above | Engine child, after mint exists | This document |
| Mint page, architecture contract, `packages/engine` Authentication section, `api/server.md` | Engine child | Its `DOCS.md` |
| Client Bearer wiring, Devtool, CLI loopback, kitchen-sink / hello-chat examples | Cutover child | Its `DOCS.md` |
| Session/resource/`transcribe` parity notes | FIX-906 | Its `DOCS.md` |

Publish each specific with its implementation. The shared opening waits until mint and
the default exist. No unchanged page is copied here.

**Voice to watch:** introduce `principal` and `mint` on first use; no "powerful" or
"seamless"; prefer periods to em-dashes; no Linear ids in `apps/docs/`.
