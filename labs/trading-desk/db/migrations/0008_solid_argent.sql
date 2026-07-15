CREATE TABLE "app"."instrument_classifications" (
	"ticker" text PRIMARY KEY NOT NULL,
	"sector" text,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
