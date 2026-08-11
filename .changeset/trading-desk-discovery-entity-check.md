---
"@flow-state-dev/trading-desk": patch
---

Web search results about a different company no longer reach the desk's analysts. Each result is checked against the company being analysed, and one that names neither it nor its ticker is dropped, leaving its URL and the reason in the run's audit trail. Searches about the market or sector around a name are exempt, since a good result there often never names the company itself. (FIX-779)

A search that could not run is no longer reported as one that ran and found nothing: when no search provider is configured, or every provider fails, the result is marked unchecked rather than verified.
