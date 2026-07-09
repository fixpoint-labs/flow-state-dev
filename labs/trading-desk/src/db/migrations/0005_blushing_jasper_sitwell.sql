-- Idempotent: this content previously shipped on this branch as
-- 0004_giant_harpoon (the FIX-874 chain) before the FIX-876 merge renumbered the
-- migrations. A dev DB that applied giant_harpoon already has all of it — every
-- statement no-ops there; a fresh DB applies it normally.
CREATE TABLE IF NOT EXISTS "app"."realized_gains" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"ticker" text NOT NULL,
	"disposed_date" date NOT NULL,
	"acquired_date" date,
	"quantity" numeric NOT NULL,
	"proceeds" numeric,
	"cost_basis" numeric,
	"gain" numeric,
	"term" text NOT NULL,
	"currency" text NOT NULL,
	"basis_unknown" text,
	"disposal_event_id" text NOT NULL,
	"lot_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."tax_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"filing_status" text NOT NULL,
	"marginal_ordinary_rate_pct" numeric NOT NULL,
	"ltcg_rate_pct" numeric NOT NULL,
	"state_rate_pct" numeric,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."ledger_events" ADD COLUMN IF NOT EXISTS "proceeds_unknown" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "app"."realized_gains" ADD CONSTRAINT "realized_gains_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "app"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "realized_gains_account_idx" ON "app"."realized_gains" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "realized_gains_user_ticker_idx" ON "app"."realized_gains" USING btree ("user_id","ticker");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "realized_gains_user_disposed_idx" ON "app"."realized_gains" USING btree ("user_id","disposed_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "realized_gains_disposal_lot_uq" ON "app"."realized_gains" USING btree ("disposal_event_id","lot_index");
--> statement-breakpoint
-- FIX-874: canonicalize existing currencies so the tax route's exact
-- `currency = 'USD'` filter is trustworthy for rows written before the ingest
-- normalizer landed (the realized-gains backfill re-derives from these).
UPDATE "app"."ledger_events" SET "currency" = upper(trim("currency")) WHERE "currency" <> upper(trim("currency"));--> statement-breakpoint
UPDATE "app"."accounts" SET "currency" = upper(trim("currency")) WHERE "currency" <> upper(trim("currency"));
