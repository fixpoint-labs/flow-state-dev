---
---

docs(resources): document external-collection change-awareness (path A). An external collection is read-through, so freshness is structural — a change becomes visible by re-reading. Documents wiring an app change event through an inbound transport to a flow action that reads the collection fresh (the idle-session path). Live-view push into an open session (path B) is noted as a deferred follow-up. No package changes.
