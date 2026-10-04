---
"@flow-state-dev/workforce": patch
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/node": patch
---

`seatAddress` accepts any well-formed organization id by percent-escaping it (ids of lowercase letters, digits and `-` keep their addresses), and `isValidOrgId` now refuses an id containing a lone UTF-16 surrogate. Route segments are decoded exactly once on every host, so a flow kind carrying a literal `%XX` resolves on Next and Vercel as on Node: `parseFlowRoute` takes decoded segments, and the new `decodePathSegments` builds them from a raw URL path.
