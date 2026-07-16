CREATE TABLE "app"."rollout_markers" (
	"marker" text PRIMARY KEY NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
