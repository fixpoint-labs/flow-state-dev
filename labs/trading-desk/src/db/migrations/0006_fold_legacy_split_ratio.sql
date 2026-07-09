-- Data fix (BP-030): an interim build of this branch stored a split's ratio in a
-- dedicated `split_ratio` column ("new ÷ old"); the merged FIX-876 model carries
-- it as `attributes: { numerator, denominator }` jsonb. A dev DB that ran the
-- interim backfill has `split` rows the new `deriveLots` would silently no-op
-- (null attributes) while their external ids block a re-backfill — so realized
-- gains would REGRESS on the next re-materialization. Fold the old shape into
-- the new one, then drop the orphan column. The whole fix is guarded on the
-- column existing (a fresh DB, or one that never ran the interim build, no-ops —
-- a bare UPDATE would fail at parse on the missing column).
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'app' AND table_name = 'ledger_events' AND column_name = 'split_ratio'
	) THEN
		UPDATE "app"."ledger_events"
			SET "attributes" = jsonb_build_object('numerator', "split_ratio"::float8, 'denominator', 1)
			WHERE "type" = 'split' AND "attributes" IS NULL AND "split_ratio" IS NOT NULL;
		ALTER TABLE "app"."ledger_events" DROP COLUMN "split_ratio";
	END IF;
END $$;
