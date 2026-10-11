---
"@flow-state-dev/workforce": minor
---

A project no longer lists mailboxes as workstreams (FIX-1792). Its row has no `workstreams` field and `createProject` takes none; `setWorkstreams`, the workstream claims (`defineWorkstreamClaimsCollection`, `WORKSTREAM_CLAIMS_RESOURCE`, `workstreamClaimSchema`), `projectWritesMailboxInventory` and `projectWorkspace`'s `board` option are removed. A project's workstreams are the entries `openWorkstream` writes, and `projectWorkspace()` finds a run's project through its workstream, its conversation's project, or the project its task names.
