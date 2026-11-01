ALTER TYPE "public"."order_status" ADD VALUE 'CANCEL';--> statement-breakpoint
CREATE TABLE "pg-drizzle_order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"source" text NOT NULL,
	"actor_user_id" text,
	"note" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pg-drizzle_order_status_history" ADD CONSTRAINT "pg-drizzle_order_status_history_order_id_pg-drizzle_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."pg-drizzle_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_order_status_history" ADD CONSTRAINT "pg-drizzle_order_status_history_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_status_history_order_id_idx" ON "pg-drizzle_order_status_history" USING btree ("order_id","created_at");