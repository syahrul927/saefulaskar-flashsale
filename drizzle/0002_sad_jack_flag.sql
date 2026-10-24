CREATE TYPE "public"."order_status" AS ENUM('UNPAID', 'CONFIRMED', 'SHIPPED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED');--> statement-breakpoint
CREATE TABLE "pg-drizzle_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_id" text,
	"email" text NOT NULL,
	"jubelio_contact_id" integer,
	"contact_name" text,
	"primary_contact" text,
	"contact_position" text,
	"phone" text,
	"s_address" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pg-drizzle_contact_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_flash_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"session_name" text NOT NULL,
	"start_time" timestamp with time zone,
	"end_time" timestamp with time zone,
	"status" "session_status" DEFAULT 'SCHEDULED' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_order_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"session_product_id" uuid NOT NULL,
	"item_id" integer NOT NULL,
	"sku" text NOT NULL,
	"item_name" text NOT NULL,
	"qty" integer NOT NULL,
	"price" integer NOT NULL,
	"subtotal" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'UNPAID' NOT NULL,
	"grand_total" integer NOT NULL,
	"payment_method" text,
	"transfer_proof_url" text,
	"jubelio_so_id" integer,
	"contact_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pg-drizzle_order_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_session_product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"item_id" integer NOT NULL,
	"sku_code" text,
	"item_group_name" text,
	"jubelio_stock" integer DEFAULT 0 NOT NULL,
	"original_price" integer NOT NULL,
	"session_quota" integer NOT NULL,
	"claimed" integer DEFAULT 0 NOT NULL,
	"min_order" integer DEFAULT 1 NOT NULL,
	"flash_price" integer NOT NULL,
	"category" text,
	CONSTRAINT "pg-drizzle_session_product_session_id_item_id_unique" UNIQUE("session_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "pg-drizzle_order_item" ADD CONSTRAINT "pg-drizzle_order_item_order_id_pg-drizzle_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."pg-drizzle_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_order_item" ADD CONSTRAINT "pg-drizzle_order_item_session_product_id_pg-drizzle_session_product_id_fk" FOREIGN KEY ("session_product_id") REFERENCES "public"."pg-drizzle_session_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_order" ADD CONSTRAINT "pg-drizzle_order_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_order" ADD CONSTRAINT "pg-drizzle_order_session_id_pg-drizzle_flash_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."pg-drizzle_flash_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_order" ADD CONSTRAINT "pg-drizzle_order_contact_id_pg-drizzle_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."pg-drizzle_contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_session_product" ADD CONSTRAINT "pg-drizzle_session_product_session_id_pg-drizzle_flash_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."pg-drizzle_flash_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flash_session_status_idx" ON "pg-drizzle_flash_session" USING btree ("status");--> statement-breakpoint
CREATE INDEX "order_item_order_id_idx" ON "pg-drizzle_order_item" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_booking_id_idx" ON "pg-drizzle_order" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "order_customer_id_idx" ON "pg-drizzle_order" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "session_product_session_id_idx" ON "pg-drizzle_session_product" USING btree ("session_id");