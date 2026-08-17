ALTER TABLE "quizzes" ALTER COLUMN "shuffle_questions" SET DEFAULT true;--> statement-breakpoint
-- And the quizzes already written, which were all left at the old default: the setting has only
-- ever been off, so there is no deliberate "ask these in order" being overwritten here. A quiz
-- that wants its written order back is one tick in the editor.
UPDATE "quizzes" SET "shuffle_questions" = true;
