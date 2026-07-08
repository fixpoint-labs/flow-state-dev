ALTER TABLE "app"."holdings" ADD COLUMN "data_quality" text;--> statement-breakpoint
ALTER TABLE "app"."ledger_events" ADD COLUMN "attributes" jsonb;