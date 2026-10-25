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
  role: userRole("role").notNull().default("STAFF"),
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
    originalPrice: t.integer("original_price").notNull(),
    sessionQuota: t.integer("session_quota").notNull(),
    claimed: t.integer("claimed").default(0).notNull(),
    minOrder: t.integer("min_order").default(1).notNull(),
    flashPrice: t.integer("flash_price").notNull(),
    category: t.text("category"),
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
    transferProofUrl: t.text("transfer_proof_url"),
    jubelioSoId: t.integer("jubelio_so_id"),
    contactId: t
      .uuid("contact_id")
      .references(() => contacts.id),
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
