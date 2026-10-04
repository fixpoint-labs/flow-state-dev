---
"@flow-state-dev/workforce": minor
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/fsdev": minor
"@flow-state-dev/bullmq": minor
"@flow-state-dev/scheduled": minor
"@flow-state-dev/node": patch
"@flow-state-dev/next": patch
"@flow-state-dev/vercel": patch
---

`seatAddress` accepts any well-formed organization id by percent-escaping it (ids of lowercase letters, digits and `-` keep their addresses; the `"Org"` member leaves `SegmentLabel`), and `isValidOrgId` now refuses an id containing a lone UTF-16 surrogate (FIX-1757). Upgrade impact of that refusal, wherever `isValidOrgId` gates: a resolver returning such an id gets 401 and `runAction` or a dispatch throws `OrgRequiredError` (engine); `fsdev run --org` rejects it (fsdev); an already-enqueued BullMQ job carrying one fails with `OrgRequiredError` instead of running (bullmq); a stored schedule row carrying one is quarantined and no longer dispatches (scheduled). Route segments are now decoded exactly once on every host, so a seat or flow id carrying a literal `%XX` no longer 404s on Next and Vercel; `parseFlowRoute`'s input contract changed to already-decoded segments (it no longer decodes or trims them), and the new `decodePathSegments` builds those from a raw URL path.
