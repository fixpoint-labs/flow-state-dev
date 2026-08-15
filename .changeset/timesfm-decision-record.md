---
---

Internal (trading-desk): records why the desk does not use a pretrained time-series forecaster. No package surface changes.

A request to integrate TimesFM for stock prediction was evaluated and declined. The blocking reason is not the model — it is that the desk has no outcome tracking, so no forecasting change can be measured as an improvement or a regression. Evidence, the two conditions that would reopen the question, and why volatility is the only seam worth targeting: [`labs/trading-desk/docs/time-series-foundation-models.md`](../labs/trading-desk/docs/time-series-foundation-models.md).
