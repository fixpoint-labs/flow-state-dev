---
"@flow-state-dev/workforce": patch
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/node": patch
"@flow-state-dev/next": patch
"@flow-state-dev/vercel": patch
---

`seatAddress` accepts any well-formed organization id by percent-escaping it (ids of lowercase letters, digits and `-` keep their addresses), and `isValidOrgId` now refuses an id containing a lone UTF-16 surrogate. Route segments are now decoded exactly once on every host, so a seat or flow id carrying a literal `%XX` no longer 404s on Next and Vercel; `parseFlowRoute`'s input contract changed to already-decoded segments (it no longer decodes or trims them), and the new `decodePathSegments` builds those from a raw URL path.
