---
"@flow-state-dev/workforce": patch
---

Three org-scoped resource collections for the live workforce inventory: `defineSeatInventoryCollection()` at `inventory/seats/*`, `defineChannelInventoryCollection()` at `inventory/channels/*`, and `defineMembershipIndexCollection()` at `inventory/members/<seatId>/<channelId>`, with `membershipKey` and `membershipPrefix` for addressing the third. Install them under any block's `resources` map; every flow in the same org reads the same rows, including apps that set `isolateOrgState`. Nothing writes the rows yet (FIX-1405).
