-- The prose leaves `stories`, now that 0003 has copied it into `story_chapters`.
--
-- A migration of its own rather than the tail of that one, so the copy and the drop are
-- separated by a commit. If the INSERT had been wrong, this is the statement that would make
-- it unrecoverable, and there is no reason for the two to be atomic: a `stories` carrying
-- both is perfectly readable, and is what 0003 leaves behind.

ALTER TABLE "stories" DROP COLUMN "paragraphs";--> statement-breakpoint
ALTER TABLE "stories" DROP COLUMN "translation";
