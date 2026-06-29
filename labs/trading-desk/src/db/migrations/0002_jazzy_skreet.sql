CREATE TABLE "app"."theses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ticker" text NOT NULL,
	"entry_rationale" text NOT NULL,
	"invalidation_conditions" text,
	"tripwires" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"time_horizon" text,
	"target_price" numeric,
	"stop_price" numeric,
	"source_session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "theses_user_ticker_uq" ON "app"."theses" USING btree ("user_id","ticker");--> statement-breakpoint
CREATE INDEX "theses_user_id_idx" ON "app"."theses" USING btree ("user_id");