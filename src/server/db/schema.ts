import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  pgTableCreator,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const createTable = pgTableCreator((name) => `pg-drizzle_${name}`);

export const posts = createTable(
  "post",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    name: d.varchar({ length: 256 }),
    createdById: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => user.id),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("created_by_idx").on(t.createdById),
    index("name_idx").on(t.name),
  ],
);

export const userRole = pgEnum("user_role", ["STAFF", "OWNER", "CUSTOMER"]);

export const sessionStatus = pgEnum("session_status", [
  "SCHEDULED",
  "ACTIVE",
  "PAUSED",
  "ENDED",
]);

export const orderStatus = pgEnum("order_status", [
  "UNPAID",
  "CONFIRMED",
  "SHIPPED",
  "COMPLETED",
  "CANCEL",
]);

export const contacts = createTable(
  "contact",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    googleId: d.text("google_id"),
    email: d.text("email").notNull().unique(),
    jubelioContactId: d.integer("jubelio_contact_id"),
    contactName: d.text("contact_name"),
    primaryContact: d.text("primary_contact"),
    contactPosition: d.text("contact_position"),
    phone: d.text("phone"),
    sAddress: d.text("s_address"),
    createdAt: d.timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
  }),
);

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  role: userRole("role").notNull().default("CUSTOMER"),
  currentCompany: integer("current_company").notNull().default(59325),
  nik: text("nik"),
  // Jubelio API token + profile name — better-auth additionalFields, so
  // they must exist as real columns (adapter validates schema against them).
  token: text("token").notNull().default(""),
  fullName: text("full_name").notNull().default(""),
  createdAt: timestamp("created_at")
    .$defaultFn(() => /* @__PURE__ */ new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const flashSessions = createTable(
  "flash_session",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    name: d.text("name").notNull(),
    sessionName: d.text("session_name").notNull(),
    startTime: d.timestamp("start_time", { withTimezone: true }),
    endTime: d.timestamp("end_time", { withTimezone: true }),
    status: sessionStatus("status").notNull().default("SCHEDULED"),
    createdAt: d.timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
  }),
  (t) => [index("flash_session_status_idx").on(t.status)],
);

export const PRODUCT_TYPES = ["single", "variable", "bundle"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  single: "Single SKU",
  variable: "Varian",
  bundle: "Bundle Pack",
};

export const sessionProducts = createTable(
  "session_product",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    sessionId: t
      .uuid("session_id")
      .notNull()
      .references(() => flashSessions.id, { onDelete: "cascade" }),
    itemId: t.integer("item_id").notNull(),
    skuCode: t.text("sku_code"),
    itemGroupName: t.text("item_group_name"),
    jubelioStock: t.integer("jubelio_stock").default(0).notNull(),
    // v2 `thumbnail` URL captured at import (snapshot, like jubelio_stock —
    // the customer surfaces render this; admin surfaces join v2 live).
    imageUrl: t.text("image_url"),
    originalPrice: t.integer("original_price").notNull(),
    sessionQuota: t.integer("session_quota").notNull(),
    claimed: t.integer("claimed").default(0).notNull(),
    minOrder: t.integer("min_order").default(1).notNull(),
    // Mid-session removal hides from the storefront; row kept (order-item FK).
    hidden: t.boolean("hidden").default(false).notNull(),
    flashPrice: t.integer("flash_price").notNull(),
    category: t.text("category"),
    type: t.text("type").notNull().default("single").$type<ProductType>(),
  }),
  (t) => [
    unique().on(t.sessionId, t.itemId),
    index("session_product_session_id_idx").on(t.sessionId),
  ],
);

export const orders = createTable(
  "order",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    bookingId: t.text("booking_id").notNull().unique(),
    customerId: t
      .text("customer_id")
      .notNull()
      .references(() => user.id),
    sessionId: t
      .uuid("session_id")
      .notNull()
      .references(() => flashSessions.id),
    status: orderStatus("status").notNull().default("UNPAID"),
    grandTotal: t.integer("grand_total").notNull(),
    paymentMethod: t.text("payment_method"),
    transferProofData: t.text("transfer_proof_data"),
    jubelioSoId: t.integer("jubelio_so_id"),
    // Faktur identity from Jubelio's hook-invoice webhook (spec 2026-11-08 §4.3).
    // Written by the hook route (and refreshed idempotently by retries); display
    // is admin/audit-only, never customer-facing.
    invoiceId: t.integer("invoice_id"),
    invoiceNo: t.text("invoice_no"),
    contactId: t
      .uuid("contact_id")
      .references(() => contacts.id),
    // Order-level recipient snapshot — collected at checkout, falls back to
    // the linked contact record for orders created before it existed.
    recipientName: t.text("recipient_name"),
    recipientPhone: t.text("recipient_phone"),
    recipientAddress: t.text("recipient_address"),
    // Filled by the order-status sync from the Jubelio SO header once it ships
    // (live probe 2026-10-29: a SHIPPED SO carries `tracking_number`
    // "001818714258" + `shipper` "SiCepat HALU"; both are "" while PAID).
    trackingNumber: t.text("tracking_number"),
    shipper: t.text("shipper"),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: t
      .timestamp("updated_at", { withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  }),
  (t) => [
    index("order_booking_id_idx").on(t.bookingId),
    index("order_customer_id_idx").on(t.customerId),
  ],
);

export const orderItems = createTable(
  "order_item",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    orderId: t
      .uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    sessionProductId: t
      .uuid("session_product_id")
      .notNull()
      .references(() => sessionProducts.id),
    itemId: t.integer("item_id").notNull(),
    sku: t.text("sku").notNull(),
    itemName: t.text("item_name").notNull(),
    qty: t.integer("qty").notNull(),
    price: t.integer("price").notNull(),
    subtotal: t.integer("subtotal").notNull(),
  }),
  (t) => [index("order_item_order_id_idx").on(t.orderId)],
);

/**
 * Jubelio observation rig (spec §4.7). Two deliberately temporary tables: they
 * exist to answer questions the upstream docs cannot, and both are pruned and
 * safe to truncate at will — nothing in the order flow reads them.
 *
 * `webhook_capture` is what a Jubelio callback actually carried. Headers arrive
 * credential-redacted (`redactHeaders`), bodies are capped
 * (`SINK_MAX_BODY_BYTES`), and the three keys we would need to join an event
 * back to a local order are lifted into real columns so the list is scannable
 * without opening every row. If those three columns stay null on real traffic,
 * the webhook design is unworkable and that is the finding.
 */
export const webhookCaptures = createTable(
  "webhook_capture",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    /** Which sink the event hit (`sales-order`, `invoice`, …) — the path segment. */
    source: t.text("source").notNull(),
    receivedAt: t
      .timestamp("received_at", { withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    method: t.text("method").notNull(),
    contentType: t.text("content_type"),
    headers: t.jsonb("headers").notNull(),
    /** Parsed JSON when it parsed; null when it did not (or was cut). */
    body: t.jsonb("body"),
    rawBody: t.text("raw_body"),
    truncated: t.boolean("truncated").notNull().default(false),
    byteLength: t.integer("byte_length").notNull(),
    salesorderId: t.integer("salesorder_id"),
    invoiceId: t.integer("invoice_id"),
    refNo: t.text("ref_no"),
  }),
  (t) => [index("webhook_capture_received_at_idx").on(t.receivedAt)],
);

/**
 * One `GET /sales/orders/{id}` read, kept verbatim. Two of these on either side
 * of creating a faktur in Jubelio is how we learn what an invoice does to an SO
 * — `channel_status: "remitted"` on a COMPLETED SO (live probe 2026-10-29) is a
 * hint we cannot read off a single snapshot.
 */
export const jubelioSoSnapshots = createTable(
  "jubelio_so_snapshot",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    orderId: t
      .uuid("order_id")
      .references(() => orders.id, { onDelete: "set null" }),
    salesorderId: t.integer("salesorder_id").notNull(),
    /** Operator's own marker for the capture ("sebelum faktur", "setelah"). */
    label: t.text("label"),
    capturedBy: t.text("captured_by").notNull(),
    capturedAt: t
      .timestamp("captured_at", { withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    internalStatus: t.text("internal_status"),
    channelStatus: t.text("channel_status"),
    wmsStatus: t.text("wms_status"),
    invoiceNo: t.text("invoice_no"),
    trackingNumber: t.text("tracking_number"),
    raw: t.jsonb("raw").notNull(),
  }),
  (t) => [
    index("jubelio_so_snapshot_so_id_idx").on(t.salesorderId, t.capturedAt),
  ],
);

/** Who caused a status transition — `order_status_history.source` (spec §4.5). */
export const STATUS_HISTORY_SOURCES = ["checkout", "admin", "sync"] as const;
export type StatusHistorySource = (typeof STATUS_HISTORY_SOURCES)[number];

export const orderStatusHistory = createTable(
  "order_status_history",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    orderId: t
      .uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    // null on the creation row: there is no status before UNPAID.
    fromStatus: orderStatus("from_status"),
    toStatus: orderStatus("to_status").notNull(),
    source: t.text("source").notNull().$type<StatusHistorySource>(),
    // Set only when `source = 'admin'`; `set null` keeps the row when the admin
    // is deleted, which is why the display layer needs a "deleted admin" label.
    actorUserId: t
      .text("actor_user_id")
      .references(() => user.id, { onDelete: "set null" }),
    note: t.text("note"),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
  }),
  (t) => [
    index("order_status_history_order_id_idx").on(t.orderId, t.createdAt),
  ],
);

export const contactRelations = relations(contacts, ({ many }) => ({
  orders: many(orders),
}));

export const flashSessionRelations = relations(
  flashSessions,
  ({ many }) => ({
    sessionProducts: many(sessionProducts),
    orders: many(orders),
  }),
);

export const sessionProductRelations = relations(
  sessionProducts,
  ({ one }) => ({
    flashSession: one(flashSessions, {
      fields: [sessionProducts.sessionId],
      references: [flashSessions.id],
    }),
  }),
);

export const orderRelations = relations(orders, ({ one, many }) => ({
  customer: one(user, { fields: [orders.customerId], references: [user.id] }),
  flashSession: one(flashSessions, {
    fields: [orders.sessionId],
    references: [flashSessions.id],
  }),
  contact: one(contacts, { fields: [orders.contactId], references: [contacts.id] }),
  orderItems: many(orderItems),
}));

export const orderItemRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  sessionProduct: one(sessionProducts, {
    fields: [orderItems.sessionProductId],
    references: [sessionProducts.id],
  }),
}));

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
  updatedAt: timestamp("updated_at").$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
});

export const userRelations = relations(user, ({ many }) => ({
  account: many(account),
  session: many(session),
  customerOrders: many(orders),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));
