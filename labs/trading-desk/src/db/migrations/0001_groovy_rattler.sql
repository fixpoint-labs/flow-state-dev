CREATE TABLE "app"."ledger_events" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"ticker" text,
	"trade_date" date NOT NULL,
	"settle_date" date,
	"quantity" numeric,
	"unit_price" numeric,
	"amount" numeric NOT NULL,
	"fee" numeric,
	"currency" text DEFAULT 'USD' NOT NULL,
	"source" text NOT NULL,
	"external_id" text,
	"fingerprint" text NOT NULL,
	"description" text,
	"basis_unknown" text,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."ledger_events" ADD CONSTRAINT "ledger_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "app"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_events_account_idx" ON "app"."ledger_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ledger_events_user_ticker_idx" ON "app"."ledger_events" USING btree ("user_id","ticker");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_events_fingerprint_uq" ON "app"."ledger_events" USING btree ("account_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_events_source_external_uq" ON "app"."ledger_events" USING btree ("source","external_id") WHERE "app"."ledger_events"."external_id" is not null;