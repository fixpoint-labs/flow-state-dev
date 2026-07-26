CREATE TABLE "app"."etf_profiles" (
	"ticker" text PRIMARY KEY NOT NULL,
	"payload" jsonb,
	"refusal_reason" text,
	"refusal_detail" text,
	"retry_at" timestamp with time zone,
	"transient_attempts" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
