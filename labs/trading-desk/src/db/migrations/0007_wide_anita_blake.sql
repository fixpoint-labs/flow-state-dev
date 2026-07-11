CREATE TABLE "app"."quotes" (
	"ticker" text PRIMARY KEY NOT NULL,
	"price" numeric NOT NULL,
	"as_of" timestamp with time zone,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
