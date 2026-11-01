CREATE TABLE "pg-drizzle_jubelio_so_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"salesorder_id" integer NOT NULL,
	"label" text,
	"captured_by" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"internal_status" text,
	"channel_status" text,
	"wms_status" text,
	"invoice_no" text,
	"tracking_number" text,
	"raw" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_webhook_capture" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"method" text NOT NULL,
	"content_type" text,
	"headers" jsonb NOT NULL,
	"body" jsonb,
	"raw_body" text,
	"truncated" boolean DEFAULT false NOT NULL,
	"byte_length" integer NOT NULL,
	"salesorder_id" integer,
	"invoice_id" integer,
	"ref_no" text
);
--> statement-breakpoint
ALTER TABLE "pg-drizzle_jubelio_so_snapshot" ADD CONSTRAINT "pg-drizzle_jubelio_so_snapshot_order_id_pg-drizzle_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."pg-drizzle_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jubelio_so_snapshot_so_id_idx" ON "pg-drizzle_jubelio_so_snapshot" USING btree ("salesorder_id","captured_at");--> statement-breakpoint
CREATE INDEX "webhook_capture_received_at_idx" ON "pg-drizzle_webhook_capture" USING btree ("received_at");