-- Uploads move from the disk into the database.
--
-- `lesson_media` and `quiz_audio` have always been indexes over files under MEDIA_DIR: a row
-- saying what the bytes are, and the bytes themselves in a sharded directory beside it. That
-- split is fine until the database travels on its own, which is exactly what a migration to a
-- new host is — the dump carries 417 rows and none of their files, and every picture in a
-- lesson and every play button in a quiz arrives broken on the other side.
--
-- So the bytes come too. Nullable, because these columns are younger than the rows: an upload
-- whose file went missing under the old scheme has nothing to backfill from, and a null is the
-- honest record of that. The serving routes already had a branch for "the row outlived its
-- bytes" — it used to be a failed read, and is now a null — so nothing downstream changes shape.
--
-- The files under MEDIA_DIR are left where they are. This migration only adds a column; the
-- copying is `npm run db:media-import`, which reads the directory and fills these in, and can
-- be run twice with no harm. Delete the directory once a backup has been taken and the pictures
-- still draw.

ALTER TABLE "lesson_media" ADD COLUMN "data" "bytea";--> statement-breakpoint
ALTER TABLE "quiz_audio" ADD COLUMN "data" "bytea";
