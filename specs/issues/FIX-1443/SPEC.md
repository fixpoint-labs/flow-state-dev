# FIX-1443 · The pentest lab stops wrapping its session client for an org

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

Improvement · `goals/pentest-lab/` only · small · 1 PR · follows FIX-1412 and FIX-1442 (both Done)

| Someone who… | Today on `main` | After |
|---|---|---|
| **runs the pentest gate** | It fails at the first channel read: the channel is bound to the development org, the lab acts as `org_pentest_lab` | It passes. Channel and seats all run as `org_pentest_lab` |
| **runs the model-backed sibling goal** | It crashes on the same read | It passes |
| **copies the lab as the channels reference** | Learns to inject `orgId` into the session body, which the server now ignores | Learns to name the org once, where the host resolves who is calling |
| **reads the lab's README or goal log** | Reads that `openChannels` can't carry an org and FIX-1412 is open | Reads the current contract: the org comes from the verified caller |

## The problem

The pentest lab wraps the session client it hands `openChannels`, adding `orgId: org_pentest_lab`
to every session-create body. The wrap was written because `openChannels` had nowhere to put an
org. The issue title assumes FIX-1412 then gave it an `orgId` parameter. FIX-1442 has since taken
that away. `openChannels` takes `{ client, userId }`. The session route sets the session's org from
the resolved caller, or from the development default when no resolver is configured, and it
ignores `body.orgId` completely (`packages/engine/src/routes/session-routes.ts`).

So the wrap has done nothing since FIX-1442, and the lab is red on `main`. Checked at `7dd56cd74`:
the gate stops at *"Session pentest.findings is bound to org `__fsd_default_org__` but request
supplied org `org_pentest_lab`"*, and the model-backed sibling crashes on the same line. The
README and the goal log still describe the gap as open and name the wrap as the fix. A reader who
copies the lab ends up writing dead code.

## The goal, and how we'll know it's met

**The lab names its org once, at the host's caller-resolution seam. It runs as `org_pentest_lab`
everywhere, as its verdict log says it should, and nothing in it teaches the body-`orgId` wrap.**

- **Smaller, and rejected:** delete the two wrap lines and nothing else. The org the lab runs under
  stays the development default, and the lab stays red.
- **Bigger, and not this issue's:** changing how the framework picks an org, or requiring one. The
  fence rules this out, and FIX-1442 already settled it.

**Evidence:** both of the lab's checks, run by hand (`goals/` isn't gated by CI):

```bash
pnpm tsx goals/pentest-lab/a-post-reaches-both-declared-seats/run.mts        # PASS (red on main)
GOAL_CONTROL=no-principal-org pnpm tsx goals/pentest-lab/a-post-reaches-both-declared-seats/run.mts  # must FAIL, naming the org mismatch
pnpm tsx goals/pentest-lab/a-seat-answers-from-its-own-document/run.mts       # PASS (needs AI_GATEWAY_API_KEY)
```

The POC at [`poc/principal-alignment/`](poc/principal-alignment/) has already run all three: the
gate passed, the control failed on the mismatch, and the sibling passed. The run log is in
[DECISIONS → Settled](DECISIONS.md#settled).

## What changes

```diff
 // goals/pentest-lab/lab/host.mts  (shape only)
 const state = createFlowState({
   flows, stores,
+  // who every request in this lab is: the lab's user, in the lab's org.
+  // Left out under the no-principal-org control, which is how that control fails.
+  ...(options.omitPrincipal === true ? {} : {
+    resolvePrincipal: () => ({ userId: LAB_USER_ID, orgId: LAB_ORG_ID }),
+  }),
 });
 const client = {
   createSession: async (create) => call("POST", [create.flowKind, "sessions"], {
     userId, sessionId, description, state,
-    // ---- the wrap, both lines of it ----
-    ...(options.omitOrgWrap === true ? {} : { orgId: LAB_ORG_ID }),
   }),
```

- `resolvePrincipal` is an existing public `createFlowState` option. It is the host-level fallback
  that every app uses to say who a request is. The lab sets it. The framework doesn't change.
- The `no-org-wrap` control becomes `no-principal-org`, which leaves the resolver out
  ([D2](DECISIONS.md#d2)).
- The gate's BR-16 leg ("an org-less request is refused `OrgRequired`") moves to the place that
  refusal now happens ([D3](DECISIONS.md#d3)).
- The lab README, the goal file, the host header and the stale comments lose the FIX-1412 story
  ([DOCS.md](DOCS.md)).

## What stays as it is

`LAB_ORG_ID`, `LAB_USER_ID`, the real HTTP session routes for opening channels, `runAction` for
every other action, the other eleven controls, and every other leg. No package code changes and no
changeset.

## Sign off

**Approve to merge.** The fence gave the direction: remove the wrap, don't pass `orgId`, align the
org through the principal, and don't touch the framework. One thing you should know: this doesn't
only delete dead code. It turns a red lab green, because the org is aligned at the resolver
([D1](DECISIONS.md#d1)). The org the lab runs as is the one it was always designed and graded to
run as.

**Open: none.**
