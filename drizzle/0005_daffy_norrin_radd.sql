ALTER TABLE "pg-drizzle_order" ADD COLUMN "recipient_name" text;--> statement-breakpoint
ALTER TABLE "pg-drizzle_order" ADD COLUMN "recipient_phone" text;--> statement-breakpoint
ALTER TABLE "pg-drizzle_order" ADD COLUMN "recipient_address" text;--> statement-breakpoint
ALTER TABLE "pg-drizzle_session_product" ADD COLUMN "type" text DEFAULT 'single' NOT NULL;