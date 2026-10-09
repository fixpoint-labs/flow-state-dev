---
"@flow-state-dev/engine": patch
---

With route-level authentication on, deleting a session, listing its children or its requests, and reading or writing its resource content (`GET`/`PATCH .../resources/:ref/.../content`, `POST .../resources/:ref`, `DELETE .../resources/:ref/:topic`) now answer 404 when the session under the id is no longer the one the caller's access was checked against: it was deleted and created again in between, by anyone, or created after the check found none. Before, these routes acted on whichever session held the id when they read it. Apps on the framework default resolver are unchanged.
