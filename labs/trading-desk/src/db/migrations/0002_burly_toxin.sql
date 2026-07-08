ALTER TABLE "app"."holdings" ADD COLUMN "asset_class" text DEFAULT 'equity' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."holdings" ADD COLUMN "asset_type" text DEFAULT 'equity' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."holdings" ADD COLUMN "attributes" jsonb DEFAULT '{"kind":"none"}'::jsonb NOT NULL;