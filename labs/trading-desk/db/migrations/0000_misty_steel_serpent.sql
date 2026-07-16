CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"cash_balance" numeric DEFAULT '0' NOT NULL,
	"risk_mandate" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."holdings" (
	"account_id" text NOT NULL,
	"ticker" text NOT NULL,
	"quantity" numeric NOT NULL,
	"cost_basis" numeric,
	"acquired_date" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holdings_account_id_ticker_pk" PRIMARY KEY("account_id","ticker")
);
--> statement-breakpoint
ALTER TABLE "app"."holdings" ADD CONSTRAINT "holdings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "app"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "app"."accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "holdings_ticker_idx" ON "app"."holdings" USING btree ("ticker");