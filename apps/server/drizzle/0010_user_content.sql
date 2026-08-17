ALTER TABLE "categories" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "words" ADD CONSTRAINT "words_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_owner_idx" ON "categories" USING btree ("owner_id","lang");--> statement-breakpoint
CREATE INDEX "stories_owner_idx" ON "stories" USING btree ("owner_id","lang");--> statement-breakpoint
CREATE INDEX "words_owner_idx" ON "words" USING btree ("owner_id","lang");