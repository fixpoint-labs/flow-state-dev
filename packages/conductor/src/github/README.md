# github

One implementation of the [observer seam](../observe), plus the pull-request writes
conductor makes. This is where GitHub's shapes are translated into the model's: REST
payloads go in, a `World` snapshot and a list of signals come out, and nothing downstream
can tell which source produced them.

| File | What it owns |
|---|---|
| `client.ts` | auth, pagination, typed errors, and which account the token is. Nothing domain-shaped. |
| `identity.ts` | who counts as a human |
| `read-world.ts` | GitHub → `World`, fetching the facts the phase's gates declare, plus the PR on a branch |
| `signals.ts` | payloads → signals, structural only |
| `poll.ts` | the read path: fresh read, reconcile, comment cursor |
| `observe.ts` | that read path, stated as an `Observer` |
| `operations.ts` | outbound PR writes — open, comment, review, reply, label |
| `blocks.ts` | the same operations as FSD handler blocks |

Two things worth knowing before changing anything here:

- **Conductor never merges.** There is no merge operation and there must not be one.
  Merging is one of the three human gates.
- **Authorship is decided structurally, from the author record GitHub sets** — never from
  what a comment says. A bot's review must not satisfy a gate, and conductor reading its
  own comment back as fresh feedback is a loop that costs money every turn.
  `identity.ts` is that guard, and it treats an unattributable author as not human.
  The guard only works if conductor knows its own login, and a token does not carry
  one — so `client.identity()` resolves it from `GET /user` when `selfLogin` was not
  configured, and **the read path raises rather than polling without it.** A token on
  an ordinary `User` account, which is what a personal access token is, looks exactly
  like a human otherwise.

- **CI is read through both of GitHub's mechanisms, always.** Check Runs and the older
  Statuses API are separate endpoints, and a repository can use either or both. Reading
  only check runs makes a repository whose CI posts commit statuses look like a
  repository with no CI at all — which does not strand it, it *exposes* it: `checks:
  null` stops the `awaiting_ci` gate applying, so review and merge open on work whose
  CI never passed. The two are folded, not fallen back through: failure outranks
  pending outranks success, and "no CI here" survives only when neither reported.

Polling is the whole read path today; webhooks come later. That is not a degraded mode —
reconciliation is what makes a poll authoritative, because a tick diffs what it read
against the previous tick instead of depending on having been listening at the right
moment.
