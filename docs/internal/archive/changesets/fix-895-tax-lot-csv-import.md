---
"@flow-state-dev/trading-desk": minor
---

Import brokerage tax-lot CSVs (unrealized open-lots and realized closed-lots files) into the transaction ledger. Both files feed the existing transaction-import path and reconstruct open positions and realized gains accurately: each realized row is a specific-lot disposal, so the ledger now carries lot identity (`lotKey` / `closesLotKey`) and `deriveLots` consumes the exact broker-matched lot rather than FIFO-guessing (FIFO stays the fallback for feeds that carry no lot identity). A one-source-per-ticker rule keeps tax-lot and feed history from mixing in one account — import tax-lot CSVs into a fresh, dedicated account; a conflict renders as a clear refusal report. The Holdings CSV importer soft-warns when a tax-lot file is uploaded there by mistake. A one-time fresh-start ledger wipe (`db:clean` in dev, a new `ledger-reset` script on deploy) precedes the rollout.
