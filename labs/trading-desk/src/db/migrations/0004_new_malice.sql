-- Idempotent (ADD COLUMN IF NOT EXISTS): this migration's journal timestamp was
-- bumped above 0004_giant_harpoon's (the FIX-874 chain this branch previously
-- shipped) so a dev DB that applied giant_harpoon still picks these columns up;
-- a DB that already has them (the FIX-876 chain) no-ops.
ALTER TABLE "app"."holdings" ADD COLUMN IF NOT EXISTS "data_quality" text;--> statement-breakpoint
ALTER TABLE "app"."ledger_events" ADD COLUMN IF NOT EXISTS "attributes" jsonb;
