---
"@flow-state-dev/engine": patch
---

Stop a lazy resource collection's first prefix read from resurrecting a key the
same request deleted. The bulk load merges the store snapshot underneath the
request cache, and a deleted key is absent from that cache rather than present
and empty, so a snapshot taken before the delete reinstated the old row. The
merge now skips keys deleted this request, tracked separately for state and
content so deleting one does not suppress the other.
